// node-app/server.js
const express = require('express');
const { Pool } = require('pg');
const Docker = require('dockerode');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Database connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Docker client setup
// Connects to the Docker daemon via the mounted socket
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

app.use(express.json());

// --- Configuration ---
// You need to set the correct Docker Compose project name here.
// This is usually the name of the directory containing your docker-compose.yml file.
const dockerComposeProjectName = 'mc-player'; // <-- !! SET THIS TO YOUR ACTUAL PROJECT DIRECTORY NAME !!
const dockerNetworkName = `${dockerComposeProjectName}_app_network`; // Construct the full network name
const desktopImageName = 'desktop-image:latest'; // The name of the image you built for the desktop

// Helper to find an available host port
// IMPORTANT: This is a basic implementation.
// A robust solution needs a more sophisticated port management strategy
// that checks for truly available ports and handles race conditions.
async function findAvailablePort(startPort = 7000, endPort = 8000) {
    // Query existing used host ports from the database
    const result = await pool.query('SELECT host_port FROM containers WHERE host_port IS NOT NULL');
    const usedPorts = new Set(result.rows.map(row => row.host_port));

    for (let p = startPort; p <= endPort; p++) {
        if (!usedPorts.has(p)) {
            // Basic check - ideally, also try binding the port to confirm
            // For this example, assuming database reflects actual usage
            return p;
        }
    }
    throw new Error('No available ports');
}


// --- API Endpoints ---

// GET /list - List all managed containers
app.get('/list', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM containers ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error('Error listing containers:', err);
    res.status(500).send('Error listing containers');
  }
});

// POST /create - Create and start a new desktop container
app.post('/create', async (req, res) => {
  let container; // Declare container variable here so it's accessible in the catch block
  let dbInsertResult; // Declare dbInsertResult here

  try {
    // Find an available host port for NoVNC
    const hostPort = await findAvailablePort();

    // --- Docker Container Creation ---
    console.log(`Creating container, mapping host port ${hostPort} to internal 6080 on network ${dockerNetworkName}`); // Log network name
    container = await docker.createContainer({ // Assign to the declared variable
      Image: desktopImageName,
      AttachStdin: false,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
      OpenStdin: false,
      StdinOnce: false,
      // Environment: ['VNC_PASSWORD=your_dynamic_password'], // Pass password securely
      ExposedPorts: { '6080/tcp': {} }, // Expose internal VNC port
      HostConfig: {
        PortBindings: {
          '6080/tcp': [{ HostPort: hostPort.toString() }], // Map internal 6080 to external hostPort
        },
        RestartPolicy: { // Optional: Restart policy
            Name: 'on-failure',
            MaximumRetryCount: 5
        },
        // Add other configs like memory limits, CPU shares if needed
      },
      NetworkingConfig: {
        EndpointsConfig: {
          // Use the full network name created by docker-compose
          [dockerNetworkName]: {} // <-- Corrected network name usage
        }
      },
    });
    console.log(`Container created with ID: ${container.id}`);

    // Store container info in DB before starting
    dbInsertResult = await pool.query( // Assign to the declared variable
        'INSERT INTO containers (container_id, vnc_port, host_port, status) VALUES ($1, $2, $3, $4) RETURNING *',
        [container.id, 6080, hostPort, 'created']
    );
    const containerInfo = dbInsertResult.rows[0];
    console.log('Container info saved to DB');

    // Start the container
    await container.start();
    console.log(`Container ${container.id} started.`);

    // Update status in DB
    await pool.query('UPDATE containers SET status = $1 WHERE id = $2', ['running', containerInfo.id]);
    console.log('Container status updated to running');


    res.status(201).json({
        message: 'Container created and started',
        container: {
            id: containerInfo.id,
            container_id: containerInfo.container_id,
            host_port: containerInfo.host_port,
            status: 'running',
            // Include connection URL hint
            connection_url: `http://your_host_ip:${containerInfo.host_port}/vnc_auto.html`
        }
     });

  } catch (err) {
    console.error('Error creating or starting container:', err);
    // Attempt to clean up if container was created but failed to start/save
    // This cleanup block is now safer because 'container' is declared outside the try
    if (container && container.id) {
        try { await container.remove({ force: true }); console.log(`Cleaned up container ${container.id}`); } catch (cleanErr) { console.error(`Failed to clean up container ${container.id}:`, cleanErr); }
    }
    // Check if the DB entry was created before trying to delete
    if (dbInsertResult && dbInsertResult.rows && dbInsertResult.rows.length > 0) {
         try { await pool.query('DELETE FROM containers WHERE container_id = $1', [dbInsertResult.rows[0].container_id]); console.log(`Cleaned up DB entry for ${dbInsertResult.rows[0].container_id}`); } catch (cleanErr) { console.error(`Failed to clean up DB entry for ${dbInsertResult.rows[0].container_id}:`, cleanErr); }
    }

    res.status(500).send(`Error creating container: ${err.message}`);
  }
});

// POST /stop/:id - Stop a container by its database ID
app.post('/stop/:id', async (req, res) => {
  const dbId = req.params.id;
  try {
    const result = await pool.query('SELECT container_id FROM containers WHERE id = $1', [dbId]);
    if (result.rows.length === 0) {
      return res.status(404).send('Container not found in DB');
    }
    const containerId = result.rows[0].container_id;

    const container = docker.getContainer(containerId);
    await container.stop();
    console.log(`Container ${containerId} stopped.`);

    await pool.query('UPDATE containers SET status = $1 WHERE id = $2', ['stopped', dbId]);
    res.json({ message: `Container ${containerId} stopped` });

  } catch (err) {
     if (err.statusCode === 404) {
         // Container not found in Docker, clean up DB? Depends on desired behavior.
         console.warn(`Container ${dbId} not found in Docker, but found in DB.`);
         // Optional: Update DB status to indicate it's gone
         // await pool.query('UPDATE containers SET status = $1 WHERE id = $2', ['not_found', dbId]);
         res.status(404).send('Container not found in Docker or already stopped');
     } else {
         console.error(`Error stopping container ${dbId}:`, err);
         res.status(500).send(`Error stopping container: ${err.message}`);
     }
  }
});

// DELETE /delete/:id - Delete a container by its database ID
app.delete('/delete/:id', async (req, res) => {
  const dbId = req.params.id;
  let containerId; // Declare containerId here

  try {
    const result = await pool.query('SELECT container_id FROM containers WHERE id = $1', [dbId]);
    if (result.rows.length === 0) {
      return res.status(404).send('Container not found in DB');
    }
    containerId = result.rows[0].container_id; // Assign to the declared variable

    const container = docker.getContainer(containerId);
    // Stop first if running, then remove
    try {
        const inspect = await container.inspect();
        if (inspect.State.Running) {
            console.log(`Stopping container ${containerId} before removing...`);
            await container.stop();
        }
    } catch (stopErr) {
         if (stopErr.statusCode !== 404) console.warn(`Could not stop container ${containerId} before removing (might be stopped already):`, stopErr.message);
    }

    await container.remove(); // Use { force: true } if stop fails often
    console.log(`Container ${containerId} removed.`);

    await pool.query('DELETE FROM containers WHERE id = $1', [dbId]);
    res.json({ message: `Container ${containerId} removed and DB entry deleted` });

  } catch (err) {
    if (err.statusCode === 404) {
         console.warn(`Container ${dbId} not found in Docker for deletion.`);
         // Clean up DB entry anyway if Docker doesn't have it
         try { await pool.query('DELETE FROM containers WHERE id = $1', [dbId]); console.log(`Cleaned up DB entry for ${dbId} as container not found in Docker`); } catch (cleanErr) { console.error(`Failed to clean up DB entry for ${dbId}:`, cleanErr); }
         res.status(404).send('Container not found in Docker or already removed. DB entry cleaned.');
    } else {
        console.error(`Error removing container ${dbId}:`, err);
        res.status(500).send(`Error removing container: ${err.message}`);
    }
  }
});

// GET /connect/:id - Get connection info for a container by its database ID
app.get('/connect/:id', async (req, res) => {
  const dbId = req.params.id;
  try {
    const result = await pool.query('SELECT host_port, status FROM containers WHERE id = $1', [dbId]);
    if (result.rows.length === 0) {
      return res.status(404).send('Container not found in DB');
    }
    const containerInfo = result.rows[0];

    if (containerInfo.status !== 'running') {
         return res.status(400).send(`Container status is '${containerInfo.status}', not running.`);
    }

    // Provide the host port. User needs to know the host's IP/domain.
    // In a real setup with a reverse proxy, this might return a specific URL path.
    res.json({
      message: 'Connect to the container',
      host_port: containerInfo.host_port,
      // Assuming NoVNC is accessible directly on host_port via http
      // For https or a subpath, a reverse proxy setup is needed.
      connection_url: `http://<your_host_ip_or_domain>:${containerInfo.host_port}/vnc_auto.html`
    });

  } catch (err) {
    console.error(`Error getting connection info for ${dbId}:`, err);
    res.status(500).send(`Error getting connection info: ${err.message}`);
  }
});


// Basic health check
app.get('/', (req, res) => {
  res.send('Desktop Manager API is running');
});


// Start the server
app.listen(port, () => {
  console.log(`Desktop Manager API listening at http://localhost:${port}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down');
  try {
    await pool.end(); // Close DB connections
    console.log('Database pool closed');
    // Note: This doesn't stop the managed Docker containers.
    // Implement logic to stop/save containers if needed.
    process.exit(0);
  } catch (err) {
    console.error('Error during shutdown', err);
    process.exit(1);
  }
});
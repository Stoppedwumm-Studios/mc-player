-- node-app/db.sql
CREATE TABLE IF NOT EXISTS containers (
    id SERIAL PRIMARY KEY,
    container_id VARCHAR(64) UNIQUE NOT NULL,
    vnc_port INTEGER NOT NULL,
    host_port INTEGER UNIQUE, -- Port mapped on the Docker host
    status VARCHAR(20) NOT NULL, -- e.g., 'created', 'running', 'stopped'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    -- Add fields for user_id if you implement user management
);
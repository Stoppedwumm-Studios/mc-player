#!/bin/bash
# desktop-image/entrypoint.sh

# Set geometry and display
GEOMETRY="${VNC_GEOMETRY:-1280x720}"
DISPLAY_NUM="${DISPLAY_NUM:-99}"
VNCDISPLAY=":$DISPLAY_NUM"
VNC_PORT="${VNC_PORT:-59"$DISPLAY_NUM"}" # VNC listens on 5900+display_num

# Set VNC password - IMPORTANT: Replace with dynamic method in production
# For a simple example, let's assume a password is set or handle it differently.
# A secure approach would involve generating or passing a password securely.
# Example (less secure):
# mkdir -p ~/.vnc
# echo "your_static_vnc_password" | vncpasswd -f > ~/.vnc/passwd
# chmod 600 ~/.vnc/passwd


# Start Xvfb (virtual framebuffer)
Xvfb $VNCDISPLAY -screen 0 "${GEOMETRY}x24" -listen tcp &
sleep 1

# Start the window manager and applications
# Needs to run in the background
xfce4-session &
sleep 1

# Start TightVNC server
# -geometry $GEOMETRY: Sets the resolution
# -depth 24: Sets the color depth
# -display $VNCDISPLAY: Links to the Xvfb display
# -localhost: Only listen on localhost (access via websockify)
# -rfbport $VNC_PORT: VNC listens on this port internally
# -passwd ~/.vnc/passwd: Use the password file (if implemented)
TightVNCServer -geometry $GEOMETRY -depth 24 -display $VNCDISPLAY -localhost -rfbport $VNC_PORT -fg &
VNC_SERVER_PID=$!
sleep 2

# Start websockify to proxy VNC to WebSocket for NoVNC
# 0.0.0.0:6080: Listen on all interfaces on port 6080
# localhost:$VNC_PORT: Connect to the VNC server running on localhost at $VNC_PORT
websockify 0.0.0.0:6080 localhost:$VNC_PORT &
WEBSOCKIFY_PID=$!

echo "VNC server started on display $VNCDISPLAY (port $VNC_PORT)"
echo "websockify started, proxying 6080 to localhost:$VNC_PORT"

# Keep the script running
wait $VNC_SERVER_PID
wait $WEBSOCKIFY_PID

echo "Entrypoint script finished."
exit 0
# desktop-image/Dockerfile
FROM ubuntu:22.04

ARG DEBIAN_FRONTEND=noninteractive
ENV TZ=Etc/UTC

# Install necessary packages: desktop environment, VNC server, NoVNC, websockify
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    xfce4 xfce4-goodies \
    tightvncserver \
    novnc \
    websockify \
    net-tools \
    xvfb \
    xterm \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Create a user (optional, but good practice)
ARG USERNAME=ubuntu
ARG USER_UID=1000
ARG USER_GID=1000

RUN groupadd --gid $USER_GID $USERNAME \
    && useradd --uid $USER_UID --gid $USER_GID -m $USERNAME \
    && apt-get update \
    && apt-get install -y sudo \
    && echo $USERNAME ALL=\(ALL\) NOPASSWD:ALL > /etc/sudoers.d/$USERNAME \
    && chmod 0440 /etc/sudoers.d/$USERNAME \
    && rm -rf /var/lib/apt/lists/*

USER $USERNAME

# Setup VNC password (for simplicity in this example, consider dynamic generation)
# echo 'password' | vncpasswd -f > ~/.vnc/passwd
# This is insecure for multiple users. A better approach is dynamic config via entrypoint.

# Copy entrypoint script
COPY entrypoint.sh /usr/local/bin/

# ... rest of Dockerfile

# Expose the NoVNC port
EXPOSE 6080

# Run the entrypoint script
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
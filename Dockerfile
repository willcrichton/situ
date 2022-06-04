FROM node:latest AS node_base

# Copy and build language-server package
WORKDIR language-server
COPY frontend/packages/situ-language-server/package*.json .
COPY frontend/packages/situ-language-server .
RUN npm install
RUN npm run build

FROM rust:latest

COPY --from=node_base . .

# Fetch rust-analyzer binary
RUN curl -L https://github.com/rust-analyzer/rust-analyzer/releases/latest/download/rust-analyzer-x86_64-unknown-linux-gnu.gz | gunzip -c - > /bin/rust-analyzer
RUN chmod +x /bin/rust-analyzer

# Install mirivis
WORKDIR /situ-backend
COPY ./backend .
RUN cargo install --path crates/mirivis
RUN rustup default nightly-2022-05-23 && cargo miri setup
ENV MIRI_SYSROOT /root/.cache/miri/HOST
ENV SYSROOT $MIRI_SYSROOT
WORKDIR /app

# Use supervisord to run ssh daemon and node simultaneously
RUN apt-get update && apt-get install -y supervisor
RUN mkdir -p /var/run/sshd /var/log/supervisor
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

EXPOSE 8081

ENTRYPOINT ["/usr/bin/supervisord"]

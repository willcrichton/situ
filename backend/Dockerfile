FROM rust:latest
WORKDIR /situ-backend
COPY ./ .
RUN cargo install --path crates/mirivis
RUN rustup default nightly-2022-05-23 && cargo miri setup
ENV MIRI_SYSROOT /root/.cache/miri/HOST
ENV SYSROOT $MIRI_SYSROOT
WORKDIR /app
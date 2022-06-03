FROM rust:latest

RUN rustup default nightly-2022-05-23 && \
    rustup component add --toolchain nightly-2022-05-23 rust-src rustc-dev llvm-tools-preview miri && \
    cargo miri setup
ENV MIRI_SYSROOT /root/.cache/miri/HOST
ENV SYSROOT $MIRI_SYSROOT

WORKDIR /mirivis
COPY crates/mirivis .
RUN cargo install --path .

WORKDIR /app
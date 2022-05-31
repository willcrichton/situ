# Situ: A Teaching Tool for Programmers

## Setup

You need to have [pnpm](https://pnpm.io/installation), [Rust](https://www.rust-lang.org/learn/get-started), [cargo-make](https://sagiegurari.github.io/cargo-make/), and [Docker](https://docs.docker.com/desktop/#download-and-install) installed. The Docker daemon must be running.

First, setup and build the project by running:

```
cargo make build
```

Then, start the server by running:

```
cargo make watch
```

And finally visit <http://localhost:4000>.

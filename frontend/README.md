# Situ: A Teaching Tool for Programmers

## Setup

You need to have [pnpm](https://pnpm.io/installation), [Rust](https://www.rust-lang.org/learn/get-started), and [Docker](https://docs.docker.com/desktop/#download-and-install) installed. The Docker daemon must be running.

First, start the backend:
```
cd backend
cargo run --bin situ-server
```

Then separately start the frontend:
```
cd frontend
pnpm init-repo
cd dist
python3 -m http.server
```

Then visit <http://localhost:8000/>.


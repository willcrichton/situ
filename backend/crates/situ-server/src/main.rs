use anyhow::Result;
use bollard::Docker;
use futures_util::{future, stream, SinkExt, StreamExt, TryStreamExt};
use serde::{Deserialize, Serialize};
use shell::Shell;
use std::sync::Arc;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Mutex;
use tokio_tungstenite::tungstenite::Message;

mod shell;

#[derive(Deserialize)]
#[serde(tag = "type")]
enum ClientMessage {
  ShellExec { command: String },
}

#[derive(Serialize)]
#[serde(tag = "type")]
enum ServerMessage {
  ShellOutput { output: String },
}

#[tokio::main]
async fn main() -> Result<()> {
  env_logger::init();

  let docker = Arc::new(Docker::connect_with_local_defaults()?);
  let listener = TcpListener::bind("127.0.0.1:8080").await?;

  while let Ok((stream, _)) = listener.accept().await {
    tokio::spawn(accept_connection(docker.clone(), stream));
  }

  Ok(())
}

async fn accept_connection(docker: Arc<Docker>, stream: TcpStream) {
  if let Err(e) = handle_connection(docker, stream).await {
    log::error!("Error processing connection: {}", e);
  }
}

async fn handle_connection(docker: Arc<Docker>, stream: TcpStream) -> Result<()> {
  let ws_stream = tokio_tungstenite::accept_async(stream).await?;
  let (write, mut read) = ws_stream.split();

  // Dumb double-clone solution. Is there a better way?
  // See: https://www.fpcomplete.com/blog/captures-closures-async/
  let write = Arc::new(Mutex::new(write));
  let write_ref = Arc::clone(&write);
  let handle_output = move |output| {
    let write_ref = Arc::clone(&write_ref);
    async move {
      let mut write = write_ref.lock().await;
      let msg = ServerMessage::ShellOutput {
        output: format!("{}", output),
      };
      let msg_str = serde_json::to_string(&msg).unwrap();
      write.send(Message::Text(msg_str)).await.unwrap();
    }
  };

  let mut shell = Shell::new(&docker, handle_output).await?;

  while let Some(msg) = read.next().await {
    let msg = msg?;
    log::info!("{msg:?}");
    match msg {
      Message::Text(s) => {
        let msg: ClientMessage = serde_json::from_str(&s)?;
        match msg {
          ClientMessage::ShellExec { command } => {
            shell.run(command).await?;
          }
        }
      }
      _ => {}
    }
  }

  Ok(())
}

use self::container::Container;
use self::shell::Shell;
use anyhow::Result;

use bollard::Docker;
use futures_util::stream::SplitSink;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Mutex;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;

mod container;
mod shell;

#[derive(Deserialize)]
#[serde(tag = "type")]
enum ClientMessage {
  ShellExec { command: String },
  OpenFile { path: String },
}

#[derive(Serialize)]
#[serde(tag = "type")]
enum ServerMessage {
  ShellOutput { output: String },
  FileContents { contents: String },
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

async fn send_message(
  write: &Arc<Mutex<SplitSink<WebSocketStream<TcpStream>, Message>>>,
  message: impl Serialize,
) -> Result<()> {
  let mut write = write.lock().await;
  let msg_str = serde_json::to_string(&message)?;
  Ok(write.send(Message::Text(msg_str)).await?)
}

async fn handle_connection(docker: Arc<Docker>, stream: TcpStream) -> Result<()> {
  let ws_stream = tokio_tungstenite::accept_async(stream).await?;
  let (write, mut read) = ws_stream.split();
  let write = Arc::new(Mutex::new(write));

  // Dumb double-clone solution. Is there a better way?
  // See: https://www.fpcomplete.com/blog/captures-closures-async/
  let write_ref = Arc::clone(&write);
  let handle_output = move |output| {
    let write_ref = Arc::clone(&write_ref);
    async move {
      send_message(
        &write_ref,
        ServerMessage::ShellOutput {
          output: format!("{}", output),
        },
      )
      .await
      .unwrap();
    }
  };

  let container = Container::new(&docker).await?;
  let mut shell = Shell::new(&container, handle_output).await?;

  while let Some(msg) = read.next().await {
    let msg = msg?;
    match msg {
      Message::Text(s) => {
        let msg: ClientMessage = serde_json::from_str(&s)?;
        match msg {
          ClientMessage::ShellExec { command } => {
            shell.run(command).await?;
          }

          ClientMessage::OpenFile { path } => {
            let contents = container.read_file(path).await?;
            send_message(&write, ServerMessage::FileContents { contents }).await?;
          }
        }
      }
      _ => {
        log::info!("{msg:?}");
      }
    }
  }

  Ok(())
}

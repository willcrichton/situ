use self::container::Container;
use self::shell::Shell;
use anyhow::Result;

use bollard::exec::{CreateExecOptions, StartExecResults};
use bollard::Docker;
use futures_util::stream::SplitSink;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::ops::ControlFlow;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::io::AsyncWriteExt;
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
  SaveFile { path: String, contents: String },
}

#[derive(Serialize)]
#[serde(tag = "type")]
enum ServerMessage {
  ShellOutput { output: String },
  FileContents { contents: String, path: PathBuf },
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
  let (writer, mut read) = ws_stream.split();
  let writer = Arc::new(Mutex::new(writer));

  let container = Container::new(&docker).await?;

  // TODO: dumb double-clone solution. Is there a better way?
  // See: https://www.fpcomplete.com/blog/captures-closures-async/
  let writer_ref = Arc::clone(&writer);
  let handle_shell_output = move |output| {
    let writer_ref = Arc::clone(&writer_ref);
    async move {
      send_message(
        &writer_ref,
        ServerMessage::ShellOutput {
          output: format!("{}", output),
        },
      )
      .await
      .unwrap();
    }
  };
  let mut shell = Shell::new(&container, handle_shell_output).await?;

  while let Some(msg) = read.next().await {
    if let ControlFlow::Break(_) = handle_message(msg?, &writer, &container, &mut shell).await? {
      break;
    }
  }

  container.cleanup().await?;

  Ok(())
}

type SocketWriter = Arc<Mutex<SplitSink<WebSocketStream<TcpStream>, Message>>>;

async fn handle_message(
  msg: Message,
  writer: &SocketWriter,
  container: &Container,
  shell: &mut Shell,
) -> Result<ControlFlow<()>> {
  match msg {
    Message::Text(s) => {
      let msg: ClientMessage = serde_json::from_str(&s)?;
      match msg {
        ClientMessage::ShellExec { command } => {
          shell.run(command).await?;
        }

        ClientMessage::OpenFile { path } => {
          let path = shell.cwd().join(path);
          let resolved = PathBuf::from(
            container
              .exec_output(vec!["ls".to_owned(), path.display().to_string()])
              .await?,
          );
          let contents = container
            .exec_output(vec!["cat".to_owned(), resolved.display().to_string()])
            .await?;
          let message = ServerMessage::FileContents {
            contents,
            path: resolved,
          };
          send_message(writer, message).await?;
        }

        ClientMessage::SaveFile { path, contents } => {
          let exec = container
            .exec(CreateExecOptions {
              attach_stdin: Some(true),
              cmd: Some(vec!["cp", "/dev/stdin", &path]),
              ..Default::default()
            })
            .await?;
          if let StartExecResults::Attached { mut input, .. } = exec {
            input.write_all(contents.as_bytes()).await?;
            input.flush().await?;
          } else {
            unreachable!()
          }
        }
      }
    }

    // The client has disconnected, so we break the loop.
    Message::Close(_) => {
      return Ok(ControlFlow::Break(()));
    }

    _ => log::info!("Unhandled message: {msg:?}"),
  };

  Ok(ControlFlow::Continue(()))
}

async fn send_message(writer: &SocketWriter, message: impl Serialize) -> Result<()> {
  let mut write = writer.lock().await;
  let msg_str = serde_json::to_string(&message)?;
  Ok(write.send(Message::Text(msg_str)).await?)
}

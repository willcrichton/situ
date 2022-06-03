use std::{ops::ControlFlow, path::PathBuf, process::Command, sync::Arc};

use anyhow::{anyhow, Context, Result};
use bollard::{
  exec::{CreateExecOptions, StartExecResults},
  Docker,
};
use futures_util::{stream::SplitSink, SinkExt, StreamExt};
use mirivis::MOutput;
use serde::{Deserialize, Serialize};
use tokio::{
  io::AsyncWriteExt,
  net::{TcpListener, TcpStream},
  sync::Mutex,
};
use tokio_tungstenite::{tungstenite::Message, WebSocketStream};
use ts_rs::TS;

use self::{container::Container, shell::Shell};

mod container;
mod shell;

#[derive(Deserialize, TS)]
#[serde(tag = "type")]
#[ts(export)]
enum ClientMessage {
  ShellExec { command: String },
  OpenFile { path: String },
  SaveFile { path: String, contents: String },
  RunVis,
}

#[derive(Serialize, TS)]
#[serde(tag = "type")]
#[ts(export)]
enum ServerMessage {
  ShellOutput { output: String },
  FileContents { contents: String, path: PathBuf },
  VisOutput { output: MOutput },
}

#[tokio::main]
async fn main() -> Result<()> {
  env_logger::init();

  let docker = Arc::new(Docker::connect_with_local_defaults()?);
  docker
    .ping()
    .await
    .context("Failed to connect to Docker, daemon is probably not running")?;

  let listener = TcpListener::bind("127.0.0.1:8080").await?;

  while let Ok((stream, _)) = listener.accept().await {
    tokio::spawn(accept_connection(docker.clone(), stream));
  }

  Ok(())
}

async fn accept_connection(docker: Arc<Docker>, stream: TcpStream) {
  if let Err(e) = handle_connection(docker, stream).await {
    log::error!("Error processing connection: {}\n{}", e, e.backtrace());
  }
}

async fn handle_connection(docker: Arc<Docker>, stream: TcpStream) -> Result<()> {
  let ws_stream = tokio_tungstenite::accept_async(stream).await?;
  let (writer, mut read) = ws_stream.split();
  let writer = Arc::new(Mutex::new(writer));

  let container = Arc::new(Container::new(&docker, "mirivis").await?);

  // TODO: dumb double-clone solution. Is there a better way?
  // See: https://www.fpcomplete.com/blog/captures-closures-async/
  let writer_ref = Arc::clone(&writer);
  let handle_shell_output = move |output| {
    let writer_ref = Arc::clone(&writer_ref);
    async move {
      send_message(&writer_ref, ServerMessage::ShellOutput {
        output: format!("{}", output),
      })
      .await
      .unwrap();
    }
  };
  let mut shell = Shell::new(&container, handle_shell_output).await?;

  while let Some(msg) = read.next().await {
    if let ControlFlow::Break(_) =
      handle_message(msg?, &writer, &container, &mut shell).await?
    {
      break;
    }
  }

  drop(shell);
  Arc::try_unwrap(container)
    .map_err(|_| anyhow!("Hanging reference to container"))?
    .cleanup()
    .await?;

  Ok(())
}

type SocketWriter = Arc<Mutex<SplitSink<WebSocketStream<TcpStream>, Message>>>;

async fn handle_message(
  msg: Message,
  writer: &SocketWriter,
  container: &Arc<Container>,
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
          let cwd_promise = shell.cwd();
          let cwd = cwd_promise.await?;
          let path = cwd.join(path);

          let mut cmd = Command::new("ls");
          cmd.arg(path).current_dir(cwd);
          let resolved = PathBuf::from(container.exec_output(&cmd).await?);

          let mut cmd = Command::new("cat");
          cmd.arg(&resolved);
          let contents = container.exec_output(&cmd).await?;

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

        ClientMessage::RunVis => {
          let cwd = shell.cwd().await?;
          let mut cmd = Command::new("cargo");
          cmd
            .arg("mirivis")
            .env("RUSTC_LOG", "error")
            .current_dir(cwd);
          let output_str = container.exec_output(&cmd).await?;
          let output = serde_json::from_str(output_str.trim())
            .with_context(|| format!("mirivis output was: {output_str}"))?;
          send_message(writer, ServerMessage::VisOutput { output }).await?;
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

use anyhow::Result;
use bollard::{
  container::LogOutput,
  exec::{CreateExecOptions, StartExecResults},
};
use futures_util::StreamExt;
use std::future::Future;
use std::pin::Pin;
use tokio::{
  io::{AsyncWrite, AsyncWriteExt},
  task::JoinHandle,
};

use crate::container::Container;

pub struct Shell {
  input: Pin<Box<dyn AsyncWrite + Send>>,
  _output_handle: JoinHandle<()>,
}

impl Shell {
  pub async fn new<Fut>(
    container: &Container,
    mut handle_output: impl (FnMut(LogOutput) -> Fut) + Send + 'static,
  ) -> Result<Self>
  where
    Fut: Future + Send + 'static,
  {
    let exec = container
      .exec(CreateExecOptions {
        attach_stdout: Some(true),
        attach_stderr: Some(true),
        attach_stdin: Some(true),
        cmd: Some(vec!["bash"]),
        ..Default::default()
      })
      .await?;
    if let StartExecResults::Attached { input, mut output } = exec {
      let output_handle = tokio::spawn(async move {
        while let Some(Ok(msg)) = output.next().await {
          handle_output(msg).await;
        }
      });
      Ok(Self {
        input,
        _output_handle: output_handle,
      })
    } else {
      unreachable!()
    }
  }

  pub async fn run(&mut self, command: impl AsRef<str>) -> Result<()> {
    let input = format!("{}\n", command.as_ref());
    self.input.write_all(input.as_bytes()).await?;

    Ok(())
  }
}

use std::{
  future::Future,
  path::{Path, PathBuf},
  pin::Pin,
};

use anyhow::Result;
use bollard::{
  container::LogOutput,
  exec::{CreateExecOptions, StartExecResults},
};
use futures_util::StreamExt;
use tokio::{
  io::{AsyncWrite, AsyncWriteExt},
  task::JoinHandle,
};

use crate::container::Container;

pub struct Shell {
  input: Pin<Box<dyn AsyncWrite + Send>>,
  cwd: PathBuf,
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
      let _output_handle = tokio::spawn(async move {
        while let Some(Ok(msg)) = output.next().await {
          handle_output(msg).await;
        }
      });
      let cwd = PathBuf::from("/");
      Ok(Self {
        input,
        cwd,
        _output_handle,
      })
    } else {
      unreachable!()
    }
  }

  pub fn cwd(&self) -> &Path {
    self.cwd.as_ref()
  }

  pub async fn run(&mut self, command: impl AsRef<str>) -> Result<()> {
    let command = command.as_ref();

    // TODO: this is super hacky and will NOT handle lots of edge cases,
    // like if any other command changes the cwd.
    let mut parts = command.split(' ').collect::<Vec<_>>();
    if parts[0] == "cd" && parts.len() > 1 {
      self.cwd.push(parts[1]);
    }

    if parts[0] == "cargo" {
      parts.push("--color=always");
    }

    let input = format!("{}\n", parts.join(" "));
    self.input.write_all(input.as_bytes()).await?;
    Ok(())
  }
}

#[cfg(test)]
mod test {
  use std::{sync::Arc, time::Duration};

  use bollard::Docker;
  use tokio::sync::Mutex;

  use super::*;

  #[tokio::test]
  async fn shell_test() -> Result<()> {
    let docker = Arc::new(Docker::connect_with_local_defaults()?);
    let container = Container::new(&docker).await?;
    let stdout = Arc::new(Mutex::new(Vec::new()));
    let stdout_ref = Arc::clone(&stdout);
    let mut shell = Shell::new(&container, move |log| {
      let stdout_ref = Arc::clone(&stdout_ref);
      async move {
        stdout_ref.lock().await.push(format!("{}", log));
      }
    })
    .await?;
    shell.run("echo hey").await?;

    // TODO: this might be flaky one day
    tokio::time::sleep(Duration::from_millis(1000)).await;
    assert_eq!(*stdout.lock().await, vec!["hey\n".to_owned()]);

    container.cleanup().await?;
    Ok(())
  }
}

use anyhow::Result;
use bollard::{
  container::{Config, CreateContainerOptions, LogOutput, StartContainerOptions},
  exec::{CreateExecOptions, StartExecResults},
  models::ContainerCreateResponse,
  Docker,
};
use futures_util::StreamExt;
use std::future::Future;
use std::pin::Pin;
use tokio::{
  io::{AsyncWrite, AsyncWriteExt},
  task::JoinHandle,
};

pub struct Shell {
  input: Pin<Box<dyn AsyncWrite + Send>>,
  output_handle: JoinHandle<()>,
}

impl Shell {
  pub async fn new<Fut>(
    docker: &Docker,
    mut handle_output: impl (FnMut(LogOutput) -> Fut) + Send + 'static,
  ) -> Result<Self>
  where
    Fut: Future + Send + 'static,
  {
    let options: Option<CreateContainerOptions<String>> = None;
    let ContainerCreateResponse { id, .. } = docker
      .create_container(
        options,
        Config {
          tty: Some(true),
          image: Some("rust"),
          ..Default::default()
        },
      )
      .await?;
    log::info!("Created container with id: {id}");

    let options: Option<StartContainerOptions<String>> = None;
    docker.start_container(&id, options).await?;
    log::info!("Container started: {id}");

    let exec = docker
      .create_exec(
        &id,
        CreateExecOptions {
          attach_stdout: Some(true),
          attach_stderr: Some(true),
          attach_stdin: Some(true),
          cmd: Some(vec!["bash"]),
          ..Default::default()
        },
      )
      .await?;
    if let StartExecResults::Attached { input, mut output } =
      docker.start_exec(&exec.id, None).await?
    {
      log::info!("Attached shell to container: {}", exec.id);
      let output_handle = tokio::spawn(async move {
        while let Some(Ok(msg)) = output.next().await {
          handle_output(msg).await;
        }
      });
      Ok(Self {
        input,
        output_handle,
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

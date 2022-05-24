use std::{sync::Arc};

use anyhow::Result;
use bollard::{
  container::{
    Config, CreateContainerOptions, LogOutput, RemoveContainerOptions, StartContainerOptions,
  },
  errors::Error,
  exec::{CreateExecOptions, StartExecResults},
  models::ContainerCreateResponse,
  Docker,
};
use futures_util::StreamExt;
use serde::Serialize;

pub struct Container {
  id: String,
  killed: bool,
  docker: Arc<Docker>,
}

impl Container {
  pub async fn new(docker: &Arc<Docker>) -> Result<Self, Error> {
    let options: Option<CreateContainerOptions<String>> = None;
    let ContainerCreateResponse { id, .. } = docker
      .create_container(
        options,
        Config {
          tty: Some(true), // to keep the container alive
          image: Some("rust"),
          ..Default::default()
        },
      )
      .await?;
    log::info!("Created container with id: {id}");

    let options: Option<StartContainerOptions<String>> = None;
    docker.start_container(&id, options).await?;
    log::info!("Container started: {id}");

    Ok(Container {
      id,
      killed: false,
      docker: docker.clone(),
    })
  }

  pub async fn exec(
    &self,
    options: CreateExecOptions<impl Into<String> + Serialize>,
  ) -> Result<StartExecResults, Error> {
    let exec = self.docker.create_exec(&self.id, options).await?;
    self.docker.start_exec(&exec.id, None).await
  }

  pub async fn exec_output(
    &self,
    cmd: Vec<impl Into<String> + Serialize + Default>,
  ) -> Result<String, Error> {
    let exec = self
      .exec(CreateExecOptions {
        attach_stdout: Some(true),
        cmd: Some(cmd),
        ..Default::default()
      })
      .await?;

    if let StartExecResults::Attached { output, .. } = exec {
      let lines = output
        .filter_map(|log| async move {
          match log {
            Ok(LogOutput::StdOut { message }) => {
              Some(String::from_utf8_lossy(message.as_ref()).to_string())
            }
            _ => None,
          }
        })
        .collect::<Vec<_>>()
        .await;
      Ok(lines.join("\n").trim_end().to_owned())
    } else {
      unreachable!()
    }
  }

  pub async fn cleanup(mut self) -> Result<(), Error> {
    self.killed = true;

    let options: Option<RemoveContainerOptions> = Some(RemoveContainerOptions {
      force: true,
      ..Default::default()
    });
    log::info!("Removing container {}", self.id);
    self.docker.remove_container(&self.id, options).await
  }
}

impl Drop for Container {
  fn drop(&mut self) {
    if !self.killed {
      log::warn!(
        "Dropping container {} without calling Container::cleanup.",
        self.id
      );
    }
  }
}

#[tokio::test]
async fn container_test() -> Result<()> {
  let docker = Arc::new(Docker::connect_with_local_defaults()?);
  let container = Container::new(&docker).await?;

  let output = container.exec_output(vec!["echo", "hey"]).await?;
  assert_eq!(output, "hey");

  container.cleanup().await?;

  Ok(())
}

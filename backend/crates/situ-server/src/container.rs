use std::sync::Arc;

use bollard::{
  container::{Config, CreateContainerOptions, LogOutput, StartContainerOptions},
  errors::Error,
  exec::{CreateExecOptions, StartExecResults},
  models::ContainerCreateResponse,
  Docker,
};
use futures_util::StreamExt;
use serde::Serialize;

pub struct Container {
  id: String,
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

  pub async fn read_file(&self, path: String) -> Result<String, Error> {
    let exec = self
      .exec(CreateExecOptions {
        attach_stdout: Some(true),
        cmd: Some(vec!["cat".to_owned(), path]),
        ..Default::default()
      })
      .await?;
    if let StartExecResults::Attached { output, .. } = exec {
      Ok(
        output
          .filter_map(|log| async move {
            match log {
              Ok(LogOutput::StdOut { message }) => {
                Some(String::from_utf8_lossy(message.as_ref()).to_string())
              }
              _ => None,
            }
          })
          .collect::<Vec<_>>()
          .await
          .join("\n"),
      )
    } else {
      unreachable!()
    }
  }
}

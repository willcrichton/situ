use std::{env, iter, process::Command, sync::Arc};

use anyhow::Result;
use bollard::{
  container::{
    Config, CreateContainerOptions, LogOutput, RemoveContainerOptions,
    StartContainerOptions,
  },
  errors::Error,
  exec::{CreateExecOptions, StartExecResults},
  models::{ContainerCreateResponse, HostConfig},
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
  pub async fn new(docker: &Arc<Docker>, image: &str) -> Result<Self, Error> {
    let options: Option<CreateContainerOptions<String>> = None;
    let cwd = env::current_dir().unwrap();
    let mount_path = cwd.join("mount");
    let config = Config {
      tty: Some(true), // to keep the container alive
      image: Some(image),
      host_config: Some(HostConfig {
        binds: Some(vec![format!("{}:/mnt", mount_path.display())]),
        ..Default::default()
      }),
      ..Default::default()
    };
    let ContainerCreateResponse { id, .. } =
      docker.create_container(options, config).await?;
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

  pub async fn get_pid(&self, process: &str) -> Result<i64, Error> {
    let mut cmd = Command::new("pidof");
    cmd.arg(process);
    let response = self.exec_output(&cmd).await?;
    Ok(
      response
        .split(' ')
        .next()
        .unwrap()
        .parse::<i64>()
        .unwrap_or_else(|_| panic!("Invalid response in get_pid: {response}")),
    )
  }

  pub async fn exec_output(&self, cmd: &Command) -> Result<String, Error> {
    let args = iter::once(cmd.get_program())
      .chain(cmd.get_args())
      .map(|s| s.to_string_lossy().to_string())
      .collect::<Vec<_>>();
    let env = cmd
      .get_envs()
      .map(|(k, v)| {
        let ks = k.to_string_lossy();
        match v {
          Some(v) => format!("{ks}={}", v.to_string_lossy()),
          None => format!("{ks}="),
        }
      })
      .collect::<Vec<_>>();
    let working_dir = cmd
      .get_current_dir()
      .map(|p| p.to_string_lossy().to_string());
    let exec = self
      .exec(CreateExecOptions {
        attach_stdout: Some(true),
        working_dir,
        env: Some(env),
        cmd: Some(args),
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
  docker.ping().await?;

  let container = Container::new(&docker, "rust").await?;

  let mut cmd = Command::new("echo");
  cmd.arg("hey");
  let output = container.exec_output(&cmd).await?;
  assert_eq!(output, "hey");

  container.cleanup().await?;

  Ok(())
}

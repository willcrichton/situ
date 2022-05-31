#![feature(rustc_private, box_patterns)]

extern crate rustc_apfloat;
extern crate rustc_driver;
extern crate rustc_hir;
extern crate rustc_interface;
extern crate rustc_middle;
extern crate rustc_session;
extern crate rustc_span;
extern crate rustc_target;
extern crate rustc_type_ir;

use rustc_driver::Compilation;
use rustc_interface::interface;
use rustc_session::CtfeBacktrace;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

mod eval;

pub use eval::{MVFrame, MVValue};

#[derive(Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MVOutput(pub Vec<MVFrame>);

struct Callbacks;
impl rustc_driver::Callbacks for Callbacks {
  fn after_analysis<'tcx>(
    &mut self,
    compiler: &interface::Compiler,
    queries: &'tcx rustc_interface::Queries<'tcx>,
  ) -> Compilation {
    compiler.session().abort_if_errors();

    queries.global_ctxt().unwrap().peek_mut().enter(|tcx| {
      let mut evaluator = eval::VisEvaluator::new(tcx).unwrap();
      *tcx.sess.ctfe_backtrace.borrow_mut() = CtfeBacktrace::Capture;

      let mut frames = Vec::new();
      loop {
        match evaluator.step() {
          Ok(Some(frame)) => {
            frames.push(frame);
          }
          Ok(None) => {
            break;
          }
          Err(e) => {
            e.print_backtrace();
            panic!("{}", e.into_kind())
          }
        }
      }

      println!("{}", serde_json::to_string(&MVOutput(frames)).unwrap());
    });

    compiler.session().abort_if_errors();

    Compilation::Stop
  }
}

pub struct MirivisPlugin;

impl rustc_plugin::RustcPlugin for MirivisPlugin {
  type Args = ();

  fn bin_name() -> String {
    "mirivis-driver".to_owned()
  }

  fn args(
    &self,
    _target_dir: &rustc_plugin::Utf8Path,
  ) -> rustc_plugin::RustcPluginArgs<Self::Args> {
    rustc_plugin::RustcPluginArgs {
      args: (),
      flags: None,
      file: None,
    }
  }

  fn run(
    self,
    compiler_args: Vec<String>,
    _plugin_args: Self::Args,
  ) -> rustc_interface::interface::Result<()> {
    rustc_driver::RunCompiler::new(&compiler_args, &mut Callbacks).run()
  }
}

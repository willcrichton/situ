#![feature(rustc_private, box_patterns)]

extern crate either;
extern crate rustc_apfloat;
extern crate rustc_data_structures;
extern crate rustc_driver;
extern crate rustc_hir;
extern crate rustc_interface;
extern crate rustc_middle;
extern crate rustc_resolve;
extern crate rustc_session;
extern crate rustc_span;
extern crate rustc_target;
extern crate rustc_type_ir;

use std::collections::HashMap;

use rustc_driver::Compilation;
use rustc_hir::def_id::{DefId, CRATE_DEF_ID};
use rustc_interface::interface;
use rustc_resolve::{Namespace, ParentScope};
use rustc_session::CtfeBacktrace;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

mod eval;
mod mvalue;

pub use eval::MFrame;
pub use mvalue::MValue;

#[derive(Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MOutput(pub Vec<MFrame>);

const TYPES: &[&str] = &["std::vec::Vec"];
pub struct TypeDefIds(HashMap<DefId, String>);
impl TypeDefIds {
  pub fn new(queries: &rustc_interface::Queries) -> Self {
    let (_, resolver, _) = &*queries.expansion().unwrap().peek();
    let mut map = HashMap::new();
    resolver.borrow_mut().access(|resolver| {
      let parent_scope =
        ParentScope::module(resolver.expect_module(CRATE_DEF_ID.to_def_id()), resolver);
      for path in TYPES {
        let resolved = resolver
          .resolve_rustdoc_path(path, Namespace::TypeNS, parent_scope)
          .unwrap();
        map.insert(resolved.def_id(), path.to_string());
      }
    });
    TypeDefIds(map)
  }

  pub fn get_path(&self, def_id: DefId) -> Option<&String> {
    self.0.get(&def_id)
  }
}

#[derive(Default)]
struct Callbacks {
  type_def_ids: Option<TypeDefIds>,
}

impl rustc_driver::Callbacks for Callbacks {
  fn after_expansion<'tcx>(
    &mut self,
    compiler: &interface::Compiler,
    queries: &'tcx rustc_interface::Queries<'tcx>,
  ) -> Compilation {
    compiler.session().abort_if_errors();

    self.type_def_ids = Some(TypeDefIds::new(queries));

    Compilation::Continue
  }

  fn after_analysis<'tcx>(
    &mut self,
    compiler: &interface::Compiler,
    queries: &'tcx rustc_interface::Queries<'tcx>,
  ) -> Compilation {
    queries.global_ctxt().unwrap().peek_mut().enter(|tcx| {
      let mut evaluator =
        eval::VisEvaluator::new(tcx, self.type_def_ids.take().unwrap()).unwrap();
      *tcx.sess.ctfe_backtrace.borrow_mut() = CtfeBacktrace::Capture;

      let mut frames: Vec<MFrame> = Vec::new();
      loop {
        match evaluator.step() {
          Ok(Some(frame)) => {
            let is_different = match frames.last() {
              Some(last) => last.locals != frame.locals,
              None => true,
            };
            if is_different {
              frames.push(frame);
            }
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

      println!(
        "{}",
        serde_json::to_string_pretty(&MOutput(frames)).unwrap()
      );
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
    rustc_driver::RunCompiler::new(&compiler_args, &mut Callbacks::default()).run()
  }
}

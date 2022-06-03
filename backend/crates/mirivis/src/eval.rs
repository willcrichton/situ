use anyhow::{anyhow, Context, Result};
use flowistry::{
  cached::Cache,
  indexed::impls::LocationDomain,
  mir::utils::SpanExt,
  source_map::{Range, Spanner},
};
use miri::{Evaluator, InterpCx, InterpResult, LocalValue, Machine, MiriConfig};
use rustc_hir::def_id::LocalDefId;
use rustc_middle::{
  mir::{Body, ClearCrossCrate, LocalInfo, Location},
  ty::TyCtxt,
};
use rustc_span::Span;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{mvalue::MValue, TypeDefIds};

#[derive(Serialize, Deserialize, Debug, TS, PartialEq)]
#[ts(export)]
pub struct MFrame {
  pub name: String,
  pub ranges: Vec<(usize, usize)>,
  pub locals: Vec<(String, MValue)>,
}

pub struct VisEvaluator<'hir, 'mir, 'tcx> {
  pub(super) tcx: TyCtxt<'tcx>,
  pub(super) ecx: InterpCx<'mir, 'tcx, Evaluator<'mir, 'tcx>>,
  pub(super) spanners: Cache<LocalDefId, Spanner<'hir, 'tcx>>,
  pub(super) type_def_ids: TypeDefIds,
}

impl<'hir, 'mir, 'tcx> VisEvaluator<'hir, 'mir, 'tcx>
where
  'tcx: 'hir,
{
  pub fn new(tcx: TyCtxt<'tcx>, type_def_ids: TypeDefIds) -> Result<Self> {
    let (main_id, entry_fn_type) = tcx
      .entry_fn(())
      .context("no main or start function found")?;
    let (ecx, _) = miri::create_ecx(tcx, main_id, entry_fn_type, &MiriConfig {
      mute_stdout_stderr: true,
      ..Default::default()
    })
    .map_err(|e| anyhow!("{e}"))?;

    Ok(VisEvaluator {
      tcx,
      ecx,
      type_def_ids,
      spanners: Cache::default(),
    })
  }

  fn spanner<'a>(
    &'a self,
    def_id: LocalDefId,
    body: &Body<'tcx>,
  ) -> &'a Spanner<'hir, 'tcx> {
    self.spanners.get(def_id, |_| {
      let hir = self.tcx.hir();
      let hir_id = hir.local_def_id_to_hir_id(def_id);
      let body_id = hir.body_owned_by(hir_id);
      Spanner::new(self.tcx, body_id, body)
    })
  }

  fn build_frame(
    &self,
    frame: &miri::Frame<'mir, 'tcx, miri::Tag, miri::FrameData<'tcx>>,
    def_id: LocalDefId,
    current_loc: &Option<Result<Location, Span>>,
  ) -> InterpResult<'tcx, MFrame> {
    let source_map = self.tcx.sess.source_map();
    let body = &frame.body;
    let location_domain = LocationDomain::new(body);

    let name = match self.tcx.opt_item_name(def_id.to_def_id()) {
      Some(sym) => sym.to_ident_string(),
      None => "Unknown".to_string(),
    };

    let spanner = self.spanner(def_id, body);
    let spans = match current_loc {
      Some(Ok(location)) => spanner.location_to_spans(
        *location,
        &location_domain,
        body,
        flowistry::source_map::EnclosingHirSpans::OuterOnly,
      ),
      Some(Err(span)) => span
        .as_local(spanner.body_span)
        .into_iter()
        .collect::<Vec<_>>(),
      None => vec![],
    };

    let ranges = Span::merge_overlaps(spans)
      .into_iter()
      .map(|span| {
        let range = Range::from_span(span, source_map).unwrap();
        (range.char_start, range.char_end)
      })
      .collect::<Vec<_>>();

    let mut locals = frame
      .locals
      .iter_enumerated()
      .filter_map(|(local, state)| {
        let decl = &body.local_decls[local];
        match (&decl.local_info, state.value) {
          (Some(box LocalInfo::User(ClearCrossCrate::Set(_))), LocalValue::Live(_)) => {
            Some((|| {
              let name = source_map.span_to_snippet(decl.source_info.span).unwrap();
              let op_ty = self.ecx.access_local(frame, local, state.layout.get())?;
              let value = self.read(&op_ty)?;
              Ok((name, value))
            })())
          }
          _ => None,
        }
      })
      .collect::<InterpResult<'tcx, Vec<_>>>()?;
    locals.sort_by_cached_key(|(k, _)| k.clone());

    Ok(MFrame {
      name,
      ranges,
      locals,
    })
  }

  pub fn step(&mut self) -> InterpResult<'tcx, Option<MFrame>> {
    let mut current_loc = None;
    loop {
      let stack = Machine::stack(&self.ecx);
      if let Some(frame) = stack.last() {
        let def_id = frame.instance.def_id();
        if def_id.is_local() {
          current_loc = Some(frame.current_loc());
        }
      }

      if !self.ecx.step()? {
        return Ok(None);
      }

      let stack = Machine::stack(&self.ecx);
      if let Some(frame) = stack.last() {
        let def_id = frame.instance.def_id();
        if let Some(local_def_id) = def_id.as_local() {
          return Ok(Some(self.build_frame(frame, local_def_id, &current_loc)?));
        }
      }
    }
  }
}

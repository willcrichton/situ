use std::collections::HashMap;

use anyhow::{anyhow, Context, Result};
use miri::{
  Evaluator, Immediate, InterpCx, InterpResult, LocalValue, Machine, MiriConfig, OpTy,
  Value,
};
use rustc_apfloat::Float;
use rustc_middle::{
  mir::{ClearCrossCrate, LocalInfo},
  ty::{AdtKind, TyCtxt, TyKind},
};
use rustc_span::Symbol;
use rustc_target::abi::Size;
use rustc_type_ir::FloatTy;
use serde::Serialize;

pub struct VisEvaluator<'mir, 'tcx> {
  tcx: TyCtxt<'tcx>,
  ecx: InterpCx<'mir, 'tcx, Evaluator<'mir, 'tcx>>,
}

#[derive(Serialize, Debug)]
#[serde(tag = "type", content = "value")]
pub enum MVValue {
  Bool(bool),
  Char(char),
  Uint(u64),
  Int(i64),
  Float(f64),
  Struct {
    name: String,
    fields: Vec<(String, MVValue)>,
  },
  String(String),
  Unallocated,
}

#[derive(Serialize, Debug)]
pub struct MVFrame {
  name: String,
  locals: HashMap<String, MVValue>,
}

impl<'mir, 'tcx> VisEvaluator<'mir, 'tcx> {
  pub fn new(tcx: TyCtxt<'tcx>) -> Result<Self> {
    let (main_id, entry_fn_type) = tcx
      .entry_fn(())
      .context("no main or start function found")?;
    let (ecx, _) = miri::create_ecx(tcx, main_id, entry_fn_type, &MiriConfig {
      ..Default::default()
    })
    .map_err(|e| anyhow!("{e}"))?;

    Ok(VisEvaluator { tcx, ecx })
  }

  fn read(&self, op: &OpTy<'tcx, miri::Tag>) -> InterpResult<'tcx, MVValue> {
    let ty = op.layout.ty;
    Ok(match ty.kind() {
      TyKind::Adt(adt_def, _subst) => match adt_def.adt_kind() {
        AdtKind::Struct => {
          let name = self.tcx.item_name(adt_def.did()).to_ident_string();
          let fields = adt_def
            .all_fields()
            .enumerate()
            .map(|(i, field)| {
              let field_op = op.project_field(&self.ecx, i)?;
              let field_val = self.read(&field_op)?;
              Ok((field.name.to_ident_string(), field_val))
            })
            .collect::<InterpResult<'tcx, Vec<_>>>()?;
          MVValue::Struct { name, fields }
        }
        _ => todo!(),
      },
      _ if ty.is_primitive() => {
        let imm = self.ecx.read_immediate(op)?;
        let scalar = match &*imm {
          Immediate::Scalar(scalar) => scalar.check_init()?,
          _ => unreachable!(),
        };
        match ty.kind() {
          TyKind::Bool => MVValue::Bool(scalar.to_bool()?),
          TyKind::Char => MVValue::Char(scalar.to_char()?),
          TyKind::Uint(uty) => MVValue::Uint(match uty.bit_width() {
            Some(width) => scalar.to_uint(Size::from_bits(width))? as u64,
            None => scalar.to_machine_usize(&self.ecx)? as u64,
          }),
          TyKind::Int(ity) => MVValue::Int(match ity.bit_width() {
            Some(width) => scalar.to_int(Size::from_bits(width))? as i64,
            None => scalar.to_machine_isize(&self.ecx)? as i64,
          }),
          TyKind::Float(fty) => MVValue::Float(match fty {
            FloatTy::F32 => f32::from_bits(scalar.to_f32()?.to_bits() as u32) as f64,
            FloatTy::F64 => f64::from_bits(scalar.to_f64()?.to_bits() as u64),
          }),
          _ => unreachable!(),
        }
      }
      _ if ty.is_str() => {
        MVValue::String(self.ecx.read_str(&op.try_as_mplace().unwrap())?.to_string())
      }
      _ if ty.is_any_ptr() => match self.ecx.deref_operand(op) {
        Ok(mplace) => self.read(&mplace.into())?,
        Err(_) => MVValue::Unallocated,
      },
      kind => todo!("{:?} / {:?}", **op, kind),
    })
  }

  fn build_frame(
    &self,
    frame: &miri::Frame<'mir, 'tcx, miri::Tag, miri::FrameData<'tcx>>,
  ) -> InterpResult<'tcx, MVFrame> {
    let source_map = self.tcx.sess.source_map();
    let body = &frame.body;
    let name = self
      .tcx
      .opt_item_name(frame.instance.def_id())
      .unwrap_or_else(|| Symbol::intern("<unknown>"))
      .to_ident_string();
    let locals = frame
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
      .collect::<InterpResult<'tcx, HashMap<_, _>>>()?;
    Ok(MVFrame { name, locals })
  }

  pub fn step(&mut self) -> InterpResult<'tcx, Option<MVFrame>> {
    while self.ecx.step()? {
      let stack = Machine::stack(&self.ecx);
      if let Some(frame) = stack.last() {
        let def_id = frame.instance.def_id();
        if def_id.is_local() {
          return Ok(Some(self.build_frame(frame)?));
        }
      }
    }

    Ok(None)
  }
}

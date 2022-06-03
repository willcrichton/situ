use miri::{
  Immediate, InterpCx, InterpResult, Machine, MemPlaceMeta, OpTy, Provenance, Value,
};
use rustc_apfloat::Float;
use rustc_middle::ty::{AdtKind, FieldDef, TyKind};
use rustc_target::abi::Size;
use rustc_type_ir::FloatTy;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::eval::VisEvaluator;

#[derive(Serialize, Deserialize, Debug, TS, PartialEq)]
#[serde(tag = "type", content = "value")]
#[ts(export)]
pub enum MValue {
  Bool(bool),
  Char(String),
  Uint(u64),
  Int(i64),
  Float(f64),
  Struct {
    name: String,
    fields: Vec<(String, MValue)>,
  },
  String(String),
  Vec(Vec<MValue>),
  Unallocated,
}

trait OpTyExt<'mir, 'tcx, Tag: Provenance, M: Machine<'mir, 'tcx>>: Sized {
  fn field_by_name(
    &self,
    name: &str,
    ecx: &InterpCx<'mir, 'tcx, M>,
  ) -> InterpResult<'tcx, (&FieldDef, Self)>;
}

impl<'mir, 'tcx, Tag: Provenance, M> OpTyExt<'mir, 'tcx, Tag, M> for OpTy<'tcx, Tag>
where
  Tag: Provenance,
  M: Machine<'mir, 'tcx, PointerTag = Tag>,
  'tcx: 'mir,
{
  fn field_by_name(
    &self,
    name: &str,
    ecx: &InterpCx<'mir, 'tcx, M>,
  ) -> InterpResult<'tcx, (&FieldDef, Self)> {
    let adt_def = self.layout.ty.ty_adt_def().unwrap();
    let (i, field) = adt_def
      .all_fields()
      .enumerate()
      .find(|(_, field)| field.name.as_str() == name)
      .unwrap_or_else(|| {
        panic!(
          "Could not find field with name `{name}` out of fields: {:?}",
          adt_def
            .all_fields()
            .map(|field| field.name)
            .collect::<Vec<_>>()
        )
      });
    Ok((field, self.project_field(ecx, i)?))
  }
}

impl<'hir, 'mir, 'tcx> VisEvaluator<'hir, 'mir, 'tcx>
where
  'tcx: 'hir,
{
  fn read_raw_vec(
    &self,
    op: &OpTy<'tcx, miri::Tag>,
    len: u64,
  ) -> InterpResult<'tcx, Vec<MValue>> {
    let (_, unique_t) = op.field_by_name("ptr", &self.ecx)?;
    let (_, nonzero_t) = unique_t.field_by_name("pointer", &self.ecx)?;
    let (_, ptr) = nonzero_t.field_by_name("pointer", &self.ecx)?;
    let place = match self.ecx.deref_operand(&ptr) {
      Ok(op) => op,
      Err(_) => {
        return Ok(vec![MValue::Unallocated]);
      }
    };

    (0 .. len)
      .map(|i| {
        let offset = place.layout.size * i;
        let offset_place =
          place.offset(offset, MemPlaceMeta::None, place.layout, &self.ecx)?;
        self.read(&offset_place.into())
      })
      .collect::<InterpResult<'tcx, Vec<_>>>()
  }

  pub(super) fn read(&self, op: &OpTy<'tcx, miri::Tag>) -> InterpResult<'tcx, MValue> {
    let ty = op.layout.ty;

    Ok(match ty.kind() {
      TyKind::Adt(adt_def, _subst) => match adt_def.adt_kind() {
        AdtKind::Struct => {
          let def_id = adt_def.did();
          let name = self.tcx.item_name(def_id).to_ident_string();

          match self.type_def_ids.get_path(def_id) {
            Some(path) => match path.as_str() {
              "std::vec::Vec" => {
                let (_, len_field) = op.field_by_name("len", &self.ecx)?;
                let len = match self.read(&len_field)? {
                  MValue::Uint(n) => n,
                  _ => unreachable!(),
                };
                let (_, buf_field) = op.field_by_name("buf", &self.ecx)?;
                let contents = self.read_raw_vec(&buf_field, len)?;
                MValue::Vec(contents)
              }
              _ => todo!(),
            },
            None => {
              let fields = adt_def
                .all_fields()
                .enumerate()
                .map(|(i, field)| {
                  let field_op = op.project_field(&self.ecx, i)?;
                  let field_val = self.read(&field_op)?;
                  Ok((field.name.to_ident_string(), field_val))
                })
                .collect::<InterpResult<'tcx, Vec<_>>>()?;

              MValue::Struct { name, fields }
            }
          }
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
          TyKind::Bool => MValue::Bool(scalar.to_bool()?),
          TyKind::Char => MValue::Char(scalar.to_char()?.to_string()),
          TyKind::Uint(uty) => MValue::Uint(match uty.bit_width() {
            Some(width) => scalar.to_uint(Size::from_bits(width))? as u64,
            None => scalar.to_machine_usize(&self.ecx)? as u64,
          }),
          TyKind::Int(ity) => MValue::Int(match ity.bit_width() {
            Some(width) => scalar.to_int(Size::from_bits(width))? as i64,
            None => scalar.to_machine_isize(&self.ecx)? as i64,
          }),
          TyKind::Float(fty) => MValue::Float(match fty {
            FloatTy::F32 => f32::from_bits(scalar.to_f32()?.to_bits() as u32) as f64,
            FloatTy::F64 => f64::from_bits(scalar.to_f64()?.to_bits() as u64),
          }),
          _ => unreachable!(),
        }
      }

      _ if ty.is_str() => {
        MValue::String(self.ecx.read_str(&op.try_as_mplace().unwrap())?.to_string())
      }

      _ if ty.is_any_ptr() => match self.ecx.deref_operand(op) {
        Ok(mplace) => self.read(&mplace.into())?,
        Err(_) => MValue::Unallocated,
      },

      kind => todo!("{:?} / {:?}", **op, kind),
    })
  }
}

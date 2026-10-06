// src/diff.ts
// Deep-diff two QRadarCustomProperty objects, returning a list of field changes.

import { QRadarCustomProperty, PropertyDiff } from './types';

/** Scalar fields to compare directly */
const SCALAR_FIELDS: (keyof QRadarCustomProperty)[] = [
  'name',
  'description',
  'property_type',
  'use_for_rule_engine',
  'enabled',
  'owner',
  'namespace',
];

export function diffProperties(
  prev: QRadarCustomProperty,
  curr: QRadarCustomProperty
): PropertyDiff[] {
  const changes: PropertyDiff[] = [];

  for (const field of SCALAR_FIELDS) {
    if (prev[field] !== curr[field]) {
      changes.push({ field, from: prev[field], to: curr[field] });
    }
  }

  // Compare expressions by id — detect added / removed / changed regex
  const prevExprs = new Map((prev.expressions ?? []).map((e) => [e.id, e]));
  const currExprs = new Map((curr.expressions ?? []).map((e) => [e.id, e]));

  for (const [id, currExpr] of currExprs) {
    const prevExpr = prevExprs.get(id);
    if (!prevExpr) {
      changes.push({ field: `expressions[${id}]`, from: undefined, to: currExpr });
    } else if (
      prevExpr.regex !== currExpr.regex ||
      prevExpr.capture_group !== currExpr.capture_group ||
      prevExpr.enabled !== currExpr.enabled
    ) {
      changes.push({
        field: `expressions[${id}]`,
        from: { regex: prevExpr.regex, capture_group: prevExpr.capture_group, enabled: prevExpr.enabled },
        to:   { regex: currExpr.regex, capture_group: currExpr.capture_group, enabled: currExpr.enabled },
      });
    }
  }

  for (const [id, prevExpr] of prevExprs) {
    if (!currExprs.has(id)) {
      changes.push({ field: `expressions[${id}]`, from: prevExpr, to: undefined });
    }
  }

  return changes;
}

/** Returns true if modification_date changed OR if a deep diff finds changes */
export function hasChanged(
  prev: QRadarCustomProperty,
  curr: QRadarCustomProperty
): boolean {
  if (prev.modification_date !== curr.modification_date) return true;
  return diffProperties(prev, curr).length > 0;
}

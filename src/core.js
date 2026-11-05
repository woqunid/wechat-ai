import { z } from 'zod';
import { LayoutDesignSchema } from './layout-design.js';

const UserText = (max = 1200) => z.string().max(max).refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value));
const TextColor = z.union([z.enum(['primary','accent','red','orange','green']), z.string().regex(/^#[0-9a-fA-F]{6}$/)]);
export const RunSchema = z.object({ text: UserText(), bold: z.boolean().optional(), underline: z.boolean().optional(), color: TextColor.optional(), highlight: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() });
export const BlockStyleSchema = z.object({
  fontSize: z.number().int().min(12).max(40).optional(),
  align: z.enum(['left','center','right','justify']).optional(),
  lineHeight: z.number().min(1.2).max(3).optional(),
  paragraphSpacing: z.number().int().min(0).max(64).optional(),
  itemSpacing: z.number().int().min(0).max(64).optional(),
  indent: z.number().int().min(0).max(4).optional(),
  imageWidth: z.number().int().min(20).max(100).optional(),
});
const BlockBase = { id: z.string().max(80), style: BlockStyleSchema.optional() };
const FieldFormatSchema = z.object({ style: BlockStyleSchema.optional(), runs: z.array(RunSchema).min(1).optional() });
export const BlockSchema = z.discriminatedUnion('type', [
  z.object({...BlockBase, type:z.literal('heading'), level:z.union([z.literal(1),z.literal(2)]), text:UserText(120), runs:z.array(RunSchema).min(1).optional()}),
  z.object({...BlockBase, type:z.literal('paragraph'), runs:z.array(RunSchema).min(1)}),
  z.object({...BlockBase, type:z.literal('callout'), runs:z.array(RunSchema).min(1)}),
  z.object({...BlockBase, type:z.literal('quote'), runs:z.array(RunSchema).min(1), cite:UserText(120).optional()}),
  z.object({...BlockBase, type:z.literal('list'), ordered:z.boolean(), items:z.array(z.array(RunSchema).min(1)).min(1).max(30)}),
  z.object({...BlockBase, type:z.literal('image'), assetId:z.string().regex(/^img_[a-zA-Z0-9_-]{3,80}$/), caption:UserText(300).optional()}),
  z.object({...BlockBase, type:z.literal('imageCard'), assetId:z.string().regex(/^img_[a-zA-Z0-9_-]{3,80}$/), title:UserText(80).optional(), caption:UserText(300).optional()}),
  z.object({...BlockBase, type:z.literal('divider')})
]);
export const ArticleSchema = z.object({html:z.string().max(600_000).optional(), schemaVersion:z.literal(1), id:z.string().max(100), mode:z.enum(['create','polish','raw']), title:UserText(80), summary:UserText(120), titleFormat:FieldFormatSchema.optional(), summaryFormat:FieldFormatSchema.optional(), blocks:z.array(BlockSchema).max(120), layoutDesign:LayoutDesignSchema.optional(), templateId:z.string().regex(/^T(?:0[1-9]|[1-3][0-9]|40)$/), settings:z.object({tone:z.enum(['formal','plain','lively']).optional(), targetLength:z.union([z.literal(600),z.literal(1000),z.literal(1500),z.literal(2000)]).optional(), accountName:UserText(64).optional(), aiGenerated:z.boolean().optional(), aiEdited:z.boolean().optional(), mockGenerated:z.boolean().optional()}), rawSourceHash:z.string().regex(/^[a-f0-9]{64}$/).optional(), createdAt:z.string().datetime(), updatedAt:z.string().datetime()});
export const uid = (prefix='id') => `${prefix}_${globalThis.crypto?.randomUUID?.().replaceAll('-', '').slice(0, 16) || Math.random().toString(36).slice(2, 12)}`;
export const textOfRuns = (runs=[]) => runs.map(r=>r.text).join('');
export const blockText = (b) => b.type==='heading'?b.text:b.type==='paragraph'||b.type==='callout'||b.type==='quote'?textOfRuns(b.runs):b.type==='list'?b.items.map(textOfRuns).join(' '):b.type==='image'||b.type==='imageCard'?[b.title,b.caption].filter(Boolean).join(' '):'';
export const articleField = (article, field) => {
  const format = article[`${field}Format`];
  const text = article[field] || '';
  return { id: `$${field}`, field, type: field === 'title' ? 'heading' : 'paragraph', ...(field === 'title' ? { level: 1, text } : {}), runs: format?.runs && textOfRuns(format.runs) === text ? format.runs : [{ text }], ...(format?.style ? { style: format.style } : {}) };
};

import { z } from 'zod';

const UserText = (max = 1200) => z.string().max(max).refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value));
export const RunSchema = z.object({ text: UserText().min(1), bold: z.boolean().optional(), color: z.enum(['primary','accent','red','orange','green']).optional() });
export const BlockSchema = z.discriminatedUnion('type', [
  z.object({id:z.string().max(80), type:z.literal('heading'), level:z.union([z.literal(1),z.literal(2)]), text:UserText(40).min(1)}),
  z.object({id:z.string().max(80), type:z.literal('paragraph'), runs:z.array(RunSchema).min(1)}),
  z.object({id:z.string().max(80), type:z.literal('callout'), runs:z.array(RunSchema).min(1)}),
  z.object({id:z.string().max(80), type:z.literal('quote'), runs:z.array(RunSchema).min(1), cite:UserText(120).optional()}),
  z.object({id:z.string().max(80), type:z.literal('list'), ordered:z.boolean(), items:z.array(z.array(RunSchema).min(1)).min(1).max(30)}),
  z.object({id:z.string().max(80), type:z.literal('image'), assetId:z.string().regex(/^img_[a-zA-Z0-9_-]{3,80}$/), caption:UserText(300).optional()}),
  z.object({id:z.string().max(80), type:z.literal('imageCard'), assetId:z.string().regex(/^img_[a-zA-Z0-9_-]{3,80}$/), title:UserText(80).optional(), caption:UserText(300).optional()}),
  z.object({id:z.string().max(80), type:z.literal('divider')})
]);
export const ArticleSchema = z.object({schemaVersion:z.literal(1), id:z.string().max(100), mode:z.enum(['create','polish','raw']), title:UserText(80), summary:UserText(120), blocks:z.array(BlockSchema).max(120), templateId:z.string().regex(/^T(?:0[1-9]|[1-3][0-9]|40)$/), settings:z.object({tone:z.enum(['formal','plain','lively']).optional(), targetLength:z.union([z.literal(600),z.literal(1000),z.literal(1500),z.literal(2000)]).optional(), accountName:UserText(64).optional(), aiGenerated:z.boolean().optional(), mockGenerated:z.boolean().optional()}), rawSourceHash:z.string().regex(/^[a-f0-9]{64}$/).optional(), createdAt:z.string().datetime(), updatedAt:z.string().datetime()});
export const uid = (prefix='id') => `${prefix}_${globalThis.crypto?.randomUUID?.().replaceAll('-', '').slice(0, 16) || Math.random().toString(36).slice(2, 12)}`;
export const textOfRuns = (runs=[]) => runs.map(r=>r.text).join('');
export const blockText = (b) => b.type==='heading'?b.text:b.type==='paragraph'||b.type==='callout'||b.type==='quote'?textOfRuns(b.runs):b.type==='list'?b.items.map(textOfRuns).join(' '):b.type==='image'||b.type==='imageCard'?[b.title,b.caption].filter(Boolean).join(' '):'';
export const articleText = (a) => [a.title,a.summary,...a.blocks.map(blockText)].filter(Boolean).join('\n');

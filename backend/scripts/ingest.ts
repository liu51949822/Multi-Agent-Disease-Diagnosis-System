import fs from 'node:fs';
import path from 'node:path';
import { Document } from '@langchain/core/documents';
import { getVectorStore } from '../src/retrieval/vectorStore';
import dotenv from 'dotenv';

dotenv.config();

const DATA_DIR = path.resolve(__dirname, '../data/plastic-guides');

/** 按 "## 小节" 切块，每块携带项目名与小节名 metadata */
function parseGuide(text: string): Document[] {
  const lines = text.split('\n');
  const procedureName = (lines.find((l) => l.startsWith('# '))?.slice(2) ?? '未知').trim();
  const docs: Document[] = [];
  let section = '';
  let buf: string[] = [];
  const flush = () => {
    const content = buf.join('\n').trim();
    if (section && content) {
      docs.push(new Document({
        pageContent: content,
        metadata: { procedureName, section, source: '整形资料库' },
      }));
    }
    buf = [];
  };
  for (const line of lines) {
    if (line.startsWith('## ')) { flush(); section = line.slice(3).trim(); }
    else if (!line.startsWith('# ')) buf.push(line);
  }
  flush();
  return docs;
}

async function main() {
  const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.txt'));
  const docs = files.flatMap((f) => parseGuide(fs.readFileSync(path.join(DATA_DIR, f), 'utf-8')));
  console.log(`解析 ${files.length} 份整形资料，共 ${docs.length} 个切块，开始入库...`);

  const store = await getVectorStore();
  await store.addDocuments(docs);
  console.log('入库完成');
  await store.end?.();
  process.exit(0);
}

main().catch((e) => { console.error('入库失败:', e); process.exit(1); });

import { mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

export class TaskStore {
  constructor(root) { this.root = root; mkdirSync(root, { recursive: true }); }
  path(id) {
    if (typeof id !== 'string' || !/^LP-[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid question ID');
    return join(this.root, `${id}.json`);
  }
  create(record) {
    writeFileSync(this.path(record.questionId), JSON.stringify({ ...record, status: 'received', createdAt: new Date().toISOString() }, null, 2), { flag: 'wx' });
  }
  save(result) {
    const taskPath = this.path(result.questionId);
    if (!existsSync(taskPath)) throw new Error('Unknown task; result was not saved');
    const task = JSON.parse(readFileSync(taskPath, 'utf8'));
    if (typeof result.title !== 'string' || !result.title.trim() || typeof result.answer !== 'string' || !result.answer.trim()) throw new Error('Result requires title and answer');
    if (result.title.length > 200 || result.answer.length > 50000) throw new Error('Result too large');
    if (task.status === 'saved') {
      if (task.result.title !== result.title || task.result.answer !== result.answer) throw new Error('A different result already exists for this task');
      return { questionId: task.questionId, intent: task.intent, title: result.title, savedPath: task.savedPath, duplicate: true };
    }
    const directory = join(this.root, task.questionId);
    mkdirSync(directory, { recursive: true });
    const note = { questionId: task.questionId, intent: task.intent, title: result.title, answer: result.answer,
      savedAt: new Date().toISOString(), source: { originalPath: task.path, capture: task.capture } };
    if (task.intent === 'note') {
      copyFileSync(task.path, join(directory, 'screen.png'));
      if (task.capture?.cropPath) copyFileSync(task.capture.cropPath, join(directory, 'detail.png'));
      note.source.archivedScreen = join(directory, 'screen.png');
      if (task.capture?.cropPath) note.source.archivedDetail = join(directory, 'detail.png');
    }
    const savedPath = join(directory, task.intent === 'note' ? 'note.txt' : 'answer.txt');
    const content = `${result.title}\n\n${result.answer}\n\n任务编号：${task.questionId}\n截图：${note.source.archivedScreen ?? task.path}\n指向坐标：${JSON.stringify(task.capture?.point ?? null)}\n`;
    writeFileSync(savedPath + '.tmp', content, 'utf8'); renameSync(savedPath + '.tmp', savedPath);
    writeFileSync(join(directory, 'result.json'), JSON.stringify(note, null, 2));
    writeFileSync(taskPath + '.tmp', JSON.stringify({ ...task, status: 'saved', savedPath, result: note }, null, 2));
    renameSync(taskPath + '.tmp', taskPath);
    return { questionId: task.questionId, intent: task.intent, title: result.title, savedPath, duplicate: false };
  }
}

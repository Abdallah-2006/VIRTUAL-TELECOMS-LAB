import type { Project } from '../types';

const DB_NAME = 'virtual-telecoms-lab';
const DB_VERSION = 1;
const STORE_NAME = 'projects';
const WORKSPACE_KEY = 'virtual-telecoms-lab:workspace:v1';

export async function saveWorkspace(project: Project): Promise<void> {
  if (typeof globalThis.localStorage === 'undefined') throw new Error('Local Storage is not available in this browser.');
  globalThis.localStorage.setItem(WORKSPACE_KEY, JSON.stringify(project));
}

export async function loadWorkspace(): Promise<Project | null> {
  if (typeof globalThis.localStorage === 'undefined') return null;
  const saved = globalThis.localStorage.getItem(WORKSPACE_KEY);
  if (!saved) return null;
  try {
    return JSON.parse(saved) as Project;
  } catch {
    globalThis.localStorage.removeItem(WORKSPACE_KEY);
    return null;
  }
}

export async function clearWorkspace(): Promise<void> {
  if (typeof globalThis.localStorage !== 'undefined') globalThis.localStorage.removeItem(WORKSPACE_KEY);
}

function openDatabase(): Promise<IDBDatabase> {
  if (!('indexedDB' in globalThis)) return Promise.reject(new Error('IndexedDB is not available in this browser.'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open local project storage.'));
  });
}

export async function saveProject(project: Project): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put({ ...project, updatedAt: new Date().toISOString() });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Project could not be saved.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Project save was canceled.'));
  });
  database.close();
}

export async function listProjects(): Promise<Project[]> {
  const database = await openDatabase();
  const projects = await new Promise<Project[]>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result as Project[]);
    request.onerror = () => reject(request.error ?? new Error('Saved projects could not be listed.'));
  });
  database.close();
  return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function deleteProject(id: string): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Saved project could not be deleted.'));
  });
  database.close();
}

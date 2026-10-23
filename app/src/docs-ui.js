import { invokeCommand } from './command-contract.js';
import { marked } from 'marked';
import createDOMPurify from 'dompurify';

export function loadDocs(invoke, ownerType, ownerId) {
  return invokeCommand(invoke, 'docs_list', { request: { ownerType, ownerId } });
}

export function readDoc(invoke, ownerType, ownerId, path) {
  return invokeCommand(invoke, 'docs_read', {
    request: { ownerType, ownerId, path: path.path, repositoryId: path.repositoryId ?? null },
  });
}

export function renderDocsMessage(container, message) {
  container.classList.add('message-only');
  const list = container.querySelector('[data-doc-files]');
  const content = container.querySelector('[data-doc-content]');
  list.replaceChildren();
  content.replaceChildren(Object.assign(document.createElement('p'), {
    className: 'docs-message',
    role: 'status',
    textContent: message,
  }));
}

export function renderDocs(container, files, onSelect) {
  container.classList.remove('message-only');
  const list = container.querySelector('[data-doc-files]');
  const groups = new Map();
  for (const file of files) {
    const key = file.repositoryId || '';
    if (!groups.has(key)) groups.set(key, { name: file.repositoryName || 'Workspace', files: [] });
    groups.get(key).files.push(file);
  }
  list.replaceChildren(...[...groups].map(([repositoryId, group]) => {
    const section = document.createElement('section');
    section.className = 'docs-source';
    const heading = document.createElement('h2');
    heading.textContent = group.name;
    const entries = document.createElement('ul');
    entries.replaceChildren(...group.files.map((file) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = file.path;
      button.title = file.path;
      if (repositoryId) button.dataset.repositoryId = repositoryId;
      button.addEventListener('click', () => onSelect(file));
      item.append(button);
      return item;
    }));
    section.append(heading, entries);
    return section;
  }));
}

export function selectDocPath(container, path) {
  container.querySelectorAll('[data-doc-files] button').forEach((button) => {
    if (button.textContent === path.path
      && (button.dataset.repositoryId || null) === (path.repositoryId || null)) {
      button.setAttribute('aria-current', 'true');
    }
    else button.removeAttribute('aria-current');
  });
}

export function renderDocContent(container, documentRecord) {
  const content = container.querySelector('[data-doc-content]');
  const heading = document.createElement('h2');
  heading.textContent = documentRecord.path;
  if (/\.md$/i.test(documentRecord.path)) {
    const article = document.createElement('article');
    article.className = 'docs-markdown';
    const dirtyHtml = marked.parse(documentRecord.contents, { async: false });
    article.innerHTML = createDOMPurify(document.defaultView).sanitize(dirtyHtml);
    content.replaceChildren(heading, article);
    return;
  }
  const pre = document.createElement('pre');
  pre.className = 'docs-text';
  pre.textContent = documentRecord.contents;
  content.replaceChildren(heading, pre);
}

export function renderDocContentMessage(container, message) {
  const content = container.querySelector('[data-doc-content]');
  content.replaceChildren(Object.assign(document.createElement('p'), {
    className: 'docs-message',
    role: 'status',
    textContent: message,
  }));
}

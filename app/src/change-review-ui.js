import { invokeCommand } from './command-contract.js';

export function loadChangeReview(invoke, ownerType, ownerId) {
  return invokeCommand(invoke, 'change_review_load', { request: { ownerType, ownerId } });
}

function appendDiff(target, file, mode) {
  target.replaceChildren();
  if (file.diffError) {
    target.textContent = file.diffError;
    return;
  }
  const text = file.diff || 'No textual differences for this file.';
  if (mode === 'unified') {
    const pre = document.createElement('pre');
    pre.className = 'change-review-unified';
    pre.textContent = text;
    target.append(pre);
    return;
  }
  const lines = text.split('\n');
  const left = document.createElement('pre');
  const right = document.createElement('pre');
  left.className = 'change-review-split';
  right.className = 'change-review-split';
  for (const line of lines) {
    if (line.startsWith('-') && !line.startsWith('---')) left.append(`${line}\n`);
    else if (line.startsWith('+') && !line.startsWith('+++')) right.append(`${line}\n`);
    else if (!line.startsWith('@@')) { left.append(`${line}\n`); right.append(`${line}\n`); }
  }
  target.append(left, right);
}

export function renderChangeReview(container, repositories) {
  const title = container.querySelector('[data-review-title]');
  const list = container.querySelector('[data-review-files]');
  const diff = container.querySelector('[data-review-diff]');
  const modeControls = container.querySelectorAll('[data-review-mode]');
  const total = repositories.reduce((sum, repo) => sum + repo.files.length, 0);
  title.textContent = `${repositories.length} ${repositories.length === 1 ? 'repository' : 'repositories'} · ${total} ${total === 1 ? 'file' : 'files'} changed`;
  list.replaceChildren();
  diff.replaceChildren();
  let mode = 'unified';
  let selected = null;
  const chooseFile = (file, button) => {
    list.querySelectorAll('[aria-current="true"]').forEach((item) => item.removeAttribute('aria-current'));
    button.setAttribute('aria-current', 'true');
    selected = file;
    container.querySelector('[data-review-file-title]').textContent = file.path;
    appendDiff(diff, file, mode);
  };
  for (const repository of repositories) {
    const group = document.createElement('section');
    group.className = 'change-review-repository';
    const heading = document.createElement('h2');
    heading.textContent = `${repository.name} (${repository.files.length})`;
    const path = document.createElement('p');
    path.textContent = repository.path;
    path.className = 'change-review-repo-path';
    const target = document.createElement('p');
    target.className = 'change-review-target';
    target.textContent = `Compare with: ${repository.comparisonTarget || 'no origin or local main/master (unavailable)'}`;
    group.append(heading, path, target);
    if (repository.comparisonError) {
      const error = document.createElement('p'); error.className = 'change-review-error';
      error.textContent = repository.comparisonError; group.append(error);
    }
    const ul = document.createElement('ul');
    for (const file of repository.files) {
      const li = document.createElement('li');
      const button = document.createElement('button'); button.type = 'button';
      button.textContent = `${file.path} · ${file.status}`;
      button.addEventListener('click', () => chooseFile(file, button));
      li.append(button); ul.append(li);
      if (!selected && !repository.comparisonError) chooseFile(file, button);
    }
    if (!repository.files.length) {
      const empty = document.createElement('li');
      empty.textContent = repository.comparisonError
        ? 'No working-tree changes to list. Comparison diff is unavailable.'
        : 'No changed files against the selected comparison branch or in the working tree.';
      ul.append(empty);
    }
    group.append(ul); list.append(group);
  }
  modeControls.forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.reviewMode === mode));
    button.onclick = () => {
      mode = button.dataset.reviewMode;
      modeControls.forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
      if (selected) appendDiff(diff, selected, mode);
    };
  });
  if (!selected) container.querySelector('[data-review-file-title]').textContent = 'Select a changed file';
  if (!repositories.length) {
    title.textContent = 'No associated repositories';
    list.textContent = 'This workspace or task has no repositories to review.';
  }
}

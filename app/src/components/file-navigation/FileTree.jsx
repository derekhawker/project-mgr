import { createMemo } from "solid-js";
import { FileTreeBranch } from "./FileTreeBranch.jsx";

// Paths are source-relative; callers keep source grouping and file identity.
function buildTree(files) {
  const root = [];
  for (const file of files) {
    const parts = file.path.split("/");
    let children = root;
    for (let i = 0; i < parts.length - 1; i++) {
      let folder = children.find(
        (node) => node.children && node.name === parts[i],
      );
      if (!folder) {
        folder = { name: parts[i], children: [] };
        children.push(folder);
      }
      children = folder.children;
    }
    children.push({ name: parts.at(-1), file });
  }
  return root;
}

// files: array of { path, ... }; onSelect(file), isSelected(file), optional renderFile(file, basename).
export function FileTree(props) {
  const nodes = createMemo(() => buildTree(props.files));
  return (
    <FileTreeBranch
      nodes={nodes()}
      onSelect={props.onSelect}
      isSelected={props.isSelected}
      renderFile={props.renderFile}
    />
  );
}

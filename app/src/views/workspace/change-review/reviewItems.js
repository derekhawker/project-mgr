export function buildReviewItems(repositories, parsePatchFiles) {
  const items = [];
  const itemByFile = new Map();
  const fileByDiff = new Map();

  for (const repository of repositories) {
    for (const file of repository.files) {
      const source = file.changeSource || "workingTree";
      const prefix = [repository.repositoryId, source, file.path]
        .map(encodeURIComponent)
        .join(":");
      if (!file.diff || file.diffError) {
        const id = `${prefix}:unavailable`;
        const fileContents = {
          name: file.path,
          contents: `Diff unavailable\n\n${file.diffError || "No text diff is available."}`,
        };
        items.push({
          id,
          type: "file",
          file: fileContents,
          collapsed: file.viewed,
        });
        itemByFile.set(file, id);
        fileByDiff.set(fileContents, { repository, file });
        continue;
      }
      const parsed = parsePatchFiles(file.diff, { cacheKeyPrefix: prefix });
      let fileIndex = 0;
      for (const patch of parsed) {
        for (const fileDiff of patch.files) {
          // Git's untracked patches use `+++ b/path` without a `diff --git`
          // header, so the parser otherwise treats `b/` as part of the path.
          fileDiff.name = file.path;
          const id = `${prefix}:${fileIndex++}`;
          items.push({ id, type: "diff", fileDiff, collapsed: file.viewed });
          itemByFile.set(file, id);
          fileByDiff.set(fileDiff, { repository, file });
        }
      }
    }
  }

  return { items, itemByFile, fileByDiff };
}

export function createReviewHeaderPrefix({
  fileByDiff,
  itemByFile,
  viewer,
  onViewedChange,
  onError,
  onSuccess,
  styles,
}) {
  return (fileDiff) => {
    const entry = fileByDiff.get(fileDiff);
    if (!entry) return undefined;
    const label = document.createElement("label");
    label.className = styles.viewedControl;
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = Boolean(entry.file.viewed);
    checkbox.setAttribute("aria-label", `Viewed ${entry.file.path}`);
    checkbox.title = "Mark file as viewed";
    checkbox.addEventListener("click", (event) => event.stopPropagation());
    checkbox.addEventListener("change", async () => {
      const viewed = checkbox.checked;
      checkbox.disabled = true;
      const itemId = itemByFile.get(entry.file);
      const item = itemId ? viewer.getItem(itemId) : undefined;
      if (item) {
        viewer.updateItem({
          ...item,
          collapsed: viewed,
          version: (item.version ?? 0) + 1,
        });
      }
      try {
        await onViewedChange?.(
          entry.repository.repositoryId,
          entry.file.path,
          viewed,
        );
        entry.file.viewed = viewed;
        onSuccess?.();
      } catch (error) {
        checkbox.checked = !viewed;
        if (item) {
          viewer.updateItem({
            ...item,
            collapsed: !viewed,
            version: (item.version ?? 0) + 1,
          });
        }
        onError?.(error);
      } finally {
        checkbox.disabled = false;
      }
    });
    label.append(checkbox);
    label.append(document.createTextNode("Viewed"));
    const prefix = document.createElement("span");
    prefix.className = styles.reviewHeaderPrefix;
    prefix.append(label);
    const badge = document.createElement("span");
    badge.className = styles.sourceBadge;
    badge.textContent =
      entry.file.changeSource === "branch" ? "Branch" : "Local";
    prefix.append(badge);
    return prefix;
  };
}

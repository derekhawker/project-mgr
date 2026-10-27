import { splitProps } from 'solid-js';
import styles from './action-menu.module.css';

export function MenuSurface(props) {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return <div {...rest} class={`${styles.surface} ${local.class || ''}`}>{local.children}</div>;
}

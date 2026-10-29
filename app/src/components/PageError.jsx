import { ErrorMessage } from "@ui-lib";

export function PageError(props) {
  return <ErrorMessage placement="banner" message={props.message} />;
}

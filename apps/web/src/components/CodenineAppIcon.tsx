// The production icon, as GitHub shows the Codenine app, whatever this build's channel.
import appIconUrl from "../../../../assets/prod/codenine-black-web-apple-touch-180.png";

export function CodenineAppIcon(props: { readonly className?: string }) {
  return <img src={appIconUrl} alt="" className={props.className} />;
}

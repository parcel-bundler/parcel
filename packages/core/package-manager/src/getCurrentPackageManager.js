// @flow

export default function getCurrentPackageManager(
  userAgent: ?string = process.env.npm_config_user_agent,
): ?{|name: string, version: string|} {
  if (!userAgent) {
    return undefined;
  }

  const pmSpec = userAgent.split(' ')[0];
  const separatorPos = pmSpec.lastIndexOf('/');
  const name = pmSpec.substring(0, separatorPos);
  return {
    name: name,
    version: pmSpec.substring(separatorPos + 1),
  };
}

pub fn parse_package_specifier(specifier: &str) -> Result<(&str, &str), ()> {
  let idx = specifier.chars().position(|p| p == '/');
  if specifier.starts_with('@') {
    let idx = idx.ok_or(())?;
    if let Some(next) = &specifier[idx + 1..].chars().position(|p| p == '/') {
      Ok((
        &specifier[0..idx + 1 + *next],
        &specifier[idx + *next + 2..],
      ))
    } else {
      Ok((&specifier[..], ""))
    }
  } else if let Some(idx) = idx {
    Ok((&specifier[0..idx], &specifier[idx + 1..]))
  } else {
    Ok((&specifier[..], ""))
  }
}

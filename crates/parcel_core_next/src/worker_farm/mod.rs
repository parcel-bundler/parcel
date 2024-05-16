pub struct WorkerFarm {
  worker_count: u8,
}

impl WorkerFarm {
  pub fn new(
    worker_count: u8,
  ) -> Self {
    Self {
      worker_count,
    }
  }

  pub fn run(&self, request: ()) -> anyhow::Result<()> {
    Ok(())
  }
}

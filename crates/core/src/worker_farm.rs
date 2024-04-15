use std::sync::Arc;

pub type WorkerCallback = Arc<dyn Fn(TaskInput) -> Result<TaskOutput, TaskError> + Send + Sync>;

pub struct WorkerFarm {
  workers: Vec<WorkerCallback>,
}

struct TaskInput {}
struct TaskOutput {}
enum TaskError {}

impl WorkerFarm {
  pub fn new() -> Self {
    Self {
      workers: Vec::new(),
    }
  }

  pub fn register_worker(&mut self, worker: WorkerCallback) {
    self.workers.push(worker);
  }

  pub fn run(&self, input: TaskInput) -> Result<TaskOutput, TaskError> {
    let worker = &self.workers[0];
    worker(input)
  }
}

impl std::fmt::Debug for WorkerFarm {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    f.write_str("WorkerFarm {}")?;
    Ok(())
  }
}

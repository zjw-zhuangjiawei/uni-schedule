use chrono::{Duration, Utc};
use criterion::{BenchmarkId, Criterion, criterion_group, criterion_main};
use std::collections::HashSet;
use uni_schedule_core::schedule::{Schedule, ScheduleLevel, ScheduleManager};
use uuid::Uuid;

fn bench_create_and_query(c: &mut Criterion) {
  let mut group = c.benchmark_group("schedule_manager");
  for &size in &[100usize, 1_000, 5_000] {
    group.bench_with_input(BenchmarkId::from_parameter(size), &size, |b, &n| {
      b.iter(|| {
        let mut mgr = ScheduleManager::new();
        let start = Utc::now();

        // create n non-overlapping schedules
        for i in 0..n {
          let s = start + Duration::hours((i as i64) * 2);
          let e = s + Duration::hours(1);
          let schedule = Schedule::new(s, e, 10 as ScheduleLevel, false, format!("task-{}", i));
          let parents: HashSet<Uuid> = HashSet::new();
          let _ = mgr.create_schedule(schedule, parents).unwrap();
        }

        // run a query that overlaps roughly half of them
        let qstart = start + Duration::hours((n as i64));
        let qend = qstart + Duration::hours(20);
        let opts = uni_schedule_core::schedule::QueryOptions::builder()
          .start(qstart)
          .stop(qend)
          .build();
        let res = mgr.query_schedule(opts);
        // simple black-box use to avoid optimizing away
        std::hint::black_box(res.len());
      })
    });
  }
  group.finish();
}

criterion_group!(benches, bench_create_and_query);
criterion_main!(benches);

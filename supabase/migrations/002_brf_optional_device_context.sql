-- Allow BRF device detections to be saved even before store/camera/planogram
-- records are fully registered. The analysis is still tied to client_id.

alter table if exists brf_vision_snapshots
  alter column camera_id drop not null,
  alter column store_id drop not null;

alter table if exists brf_gondola_status
  alter column planogram_position_id drop not null,
  alter column store_id drop not null;

alter table if exists brf_operation_detections
  alter column store_id drop not null;

alter table if exists brf_prep_sessions
  alter column store_id drop not null;

alter table if exists brf_queue_detections
  alter column store_id drop not null;

alter table if exists brf_queue_sessions
  alter column store_id drop not null;

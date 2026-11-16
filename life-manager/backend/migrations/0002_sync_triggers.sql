-- =============================================================================
-- 0002_sync_triggers.sql
-- Automatic AFTER INSERT OR UPDATE OR DELETE triggers on the 8 mobile-synced
-- tables populating sync_change_log (server_seq BIGSERIAL)
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_record_mobile_sync_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_row JSONB;
    v_entity_id TEXT;
    v_op TEXT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_row := to_jsonb(OLD);
        v_op := 'delete';
    ELSE
        v_row := to_jsonb(NEW);
        IF (v_row ->> 'deleted_at') IS NOT NULL THEN
            v_op := 'delete';
        ELSE
            v_op := 'upsert';
        END IF;
    END IF;

    v_entity_id := COALESCE(v_row ->> 'id', v_row ->> 'log_date');
    IF TG_TABLE_NAME = 'daily_checkins' AND (v_row ->> 'id') IS NULL THEN
        v_row := v_row || jsonb_build_object('id', v_entity_id);
    END IF;

    INSERT INTO sync_change_log (entity_table, entity_id, op, payload, changed_at)
    VALUES (TG_TABLE_NAME::TEXT, v_entity_id, v_op, v_row, NOW());

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$;

CREATE TRIGGER trg_sync_projects
    AFTER INSERT OR UPDATE OR DELETE ON projects
    FOR EACH ROW EXECUTE FUNCTION fn_record_mobile_sync_change();

CREATE TRIGGER trg_sync_tasks
    AFTER INSERT OR UPDATE OR DELETE ON tasks
    FOR EACH ROW EXECUTE FUNCTION fn_record_mobile_sync_change();

CREATE TRIGGER trg_sync_time_sessions
    AFTER INSERT OR UPDATE OR DELETE ON time_sessions
    FOR EACH ROW EXECUTE FUNCTION fn_record_mobile_sync_change();

CREATE TRIGGER trg_sync_routines
    AFTER INSERT OR UPDATE OR DELETE ON routines
    FOR EACH ROW EXECUTE FUNCTION fn_record_mobile_sync_change();

CREATE TRIGGER trg_sync_routine_items
    AFTER INSERT OR UPDATE OR DELETE ON routine_items
    FOR EACH ROW EXECUTE FUNCTION fn_record_mobile_sync_change();

CREATE TRIGGER trg_sync_routine_logs
    AFTER INSERT OR UPDATE OR DELETE ON routine_logs
    FOR EACH ROW EXECUTE FUNCTION fn_record_mobile_sync_change();

CREATE TRIGGER trg_sync_daily_checkins
    AFTER INSERT OR UPDATE OR DELETE ON daily_checkins
    FOR EACH ROW EXECUTE FUNCTION fn_record_mobile_sync_change();

CREATE TRIGGER trg_sync_companion_offline_phrases
    AFTER INSERT OR UPDATE OR DELETE ON companion_offline_phrases
    FOR EACH ROW EXECUTE FUNCTION fn_record_mobile_sync_change();

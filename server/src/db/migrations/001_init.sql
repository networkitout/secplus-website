CREATE TABLE users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  login VARCHAR(64) NOT NULL,
  name VARCHAR(64) NOT NULL,
  password_hash VARCHAR(100) NOT NULL,
  role ENUM('learner','admin') NOT NULL DEFAULT 'learner',
  time_zone VARCHAR(64) NOT NULL DEFAULT 'UTC',
  exam_date DATE NULL,
  active BOOL NOT NULL DEFAULT 1,
  hide_from_leaderboard BOOL NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_active_at DATETIME(3) NULL,
  UNIQUE KEY uq_users_login (login)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE invites (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  token_hash CHAR(64) NOT NULL,
  purpose ENUM('invite','reset') NOT NULL,
  user_id INT UNSIGNED NULL,
  created_by INT UNSIGNED NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  used_at DATETIME(3) NULL,
  UNIQUE KEY uq_invites_token (token_hash),
  CONSTRAINT fk_invites_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_invites_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sessions (
  id_hash CHAR(64) NOT NULL PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE lesson_progress (
  user_id INT UNSIGNED NOT NULL,
  objective VARCHAR(16) NOT NULL,
  sections_done JSON NOT NULL,
  completed_at DATETIME(3) NULL,
  PRIMARY KEY (user_id, objective),
  CONSTRAINT fk_lesson_progress_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE assessments (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  kind ENUM('objective','domain','mock') NOT NULL,
  scope VARCHAR(8) NULL,
  question_ids JSON NOT NULL,
  answers JSON NOT NULL,
  flags JSON NOT NULL,
  started_at DATETIME(3) NOT NULL,
  deadline_at DATETIME(3) NULL,
  submitted_at DATETIME(3) NULL,
  score_pct DECIMAL(5,2) NULL,
  scaled_score INT NULL,
  passed BOOL NULL,
  breakdown JSON NULL,
  CONSTRAINT fk_assessments_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE attempts (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  question_id VARCHAR(40) NOT NULL,
  correct BOOL NOT NULL,
  context ENUM('lesson','quiz','review','exam','lab') NOT NULL,
  assessment_id INT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_attempts_user_question (user_id, question_id, created_at),
  UNIQUE KEY uq_attempts_assessment_question (assessment_id, question_id),
  CONSTRAINT fk_attempts_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_attempts_assessment FOREIGN KEY (assessment_id) REFERENCES assessments (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE review_cards (
  user_id INT UNSIGNED NOT NULL,
  card_id VARCHAR(48) NOT NULL,
  box TINYINT NOT NULL,
  due_on DATE NOT NULL,
  PRIMARY KEY (user_id, card_id),
  INDEX idx_review_cards_due (user_id, due_on),
  CONSTRAINT fk_review_cards_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE lab_results (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  lab_id VARCHAR(40) NOT NULL,
  score_pct DECIMAL(5,2) NOT NULL,
  passed BOOL NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_lab_results_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE xp_events (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  amount INT NOT NULL,
  reason VARCHAR(32) NOT NULL,
  ref VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_xp_events_ref (user_id, reason, ref),
  INDEX idx_xp_events_user_created (user_id, created_at),
  CONSTRAINT fk_xp_events_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE badges (
  user_id INT UNSIGNED NOT NULL,
  badge_id VARCHAR(32) NOT NULL,
  earned_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, badge_id),
  CONSTRAINT fk_badges_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

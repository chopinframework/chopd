use ratatui::{
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, List, ListItem, Paragraph},
    Frame,
};

use crate::app::{App, AppState};

pub mod ui {
    use super::*;

    pub fn draw(f: &mut Frame, app: &App) {
        // Create the layout
        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .margin(1)
            .constraints([
                Constraint::Length(3),  // Status bar
                Constraint::Min(0),     // Logs
            ])
            .split(f.size());

        draw_status_bar(f, app, chunks[0]);
        draw_logs(f, app, chunks[1]);
    }

    fn draw_status_bar(f: &mut Frame, app: &App, area: Rect) {
        let (status_text, color) = match app.state() {
            AppState::Starting => ("Starting...", Color::Yellow),
            AppState::Running => ("Running", Color::Green),
            AppState::Error(_) => ("Error", Color::Red),
            AppState::Stopping => ("Stopping...", Color::Yellow),
        };

        let config = app.config();
        let status = format!(
            "Status: {} | Proxy: :{} → :{} | Requests: {}",
            status_text,
            config.proxy_port,
            config.target_port,
            app.get_request_count()
        );

        let text = vec![Line::from(vec![
            Span::styled(
                status,
                Style::default()
                    .fg(color)
                    .add_modifier(Modifier::BOLD),
            ),
        ])];

        let status_bar = Paragraph::new(text)
            .block(Block::default().borders(Borders::ALL).title("chopd-rs"));

        f.render_widget(status_bar, area);
    }

    fn draw_logs(f: &mut Frame, app: &App, area: Rect) {
        let logs_data = app.get_logs();
        let logs: Vec<ListItem> = logs_data
            .iter()
            .map(|(timestamp, message)| {
                let elapsed = timestamp.elapsed();
                let time_str = format!(
                    "{:02}:{:02}:{:02}",
                    elapsed.as_secs() / 3600,
                    (elapsed.as_secs() % 3600) / 60,
                    elapsed.as_secs() % 60
                );

                ListItem::new(Line::from(vec![
                    Span::styled(
                        format!("[{}] ", time_str),
                        Style::default().fg(Color::Gray),
                    ),
                    Span::raw(message),
                ]))
            })
            .collect();

        let logs_list = List::new(logs)
            .block(Block::default().borders(Borders::ALL).title("Logs"))
            .style(Style::default().fg(Color::White))
            .highlight_style(Style::default().add_modifier(Modifier::BOLD))
            .highlight_symbol(">> ");

        f.render_widget(logs_list, area);
    }
} 
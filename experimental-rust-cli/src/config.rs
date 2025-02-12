use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use anyhow::{Context, Result};
use clap::Parser;
use serde::{Deserialize, Serialize};

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
pub struct Args {
    /// Command to run (e.g., 'init')
    #[arg(index = 1)]
    pub command: Option<String>,

    /// Proxy server port
    #[arg(index = 2)]
    pub proxy_port: Option<u16>,

    /// Target server port
    #[arg(index = 3)]
    pub target_port: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    /// Command to start the target development server
    pub command: String,
    
    /// Port for the proxy server (default: 4000)
    #[serde(default = "default_proxy_port")]
    pub proxy_port: u16,
    
    /// Port for the target server (default: 3000)
    #[serde(default = "default_target_port")]
    pub target_port: u16,
    
    /// Environment variables to pass to the target process
    #[serde(default)]
    pub env: HashMap<String, String>,
}

fn default_proxy_port() -> u16 {
    4000
}

fn default_target_port() -> u16 {
    3000
}

impl Config {
    pub fn new() -> Result<Self> {
        let args = Args::parse();
        
        // Handle 'init' command
        if let Some(cmd) = args.command {
            if cmd == "init" {
                return Self::init();
            }
        }
        
        // Try to load config file
        let config_path = PathBuf::from("chopin.config.json");
        if config_path.exists() {
            let config_str = fs::read_to_string(&config_path)
                .context("Failed to read config file")?;
            
            let mut config: Config = serde_json::from_str(&config_str)
                .context("Failed to parse config file")?;
            
            // Override with command line args if provided
            if let Some(proxy_port) = args.proxy_port {
                config.proxy_port = proxy_port;
            }
            if let Some(target_port) = args.target_port {
                config.target_port = target_port;
            }
            
            return Ok(config);
        }
        
        // No config file, use defaults with command line args
        Ok(Config {
            command: String::from("npm run dev"),
            proxy_port: args.proxy_port.unwrap_or(4000),
            target_port: args.target_port.unwrap_or(3000),
            env: HashMap::new(),
        })
    }
    
    fn init() -> Result<Self> {
        // Create .chopin directory
        fs::create_dir_all(".chopin")?;
        
        // Create default config
        let config = Config {
            command: String::from("npm run dev"),
            proxy_port: 4000,
            target_port: 3000,
            env: HashMap::new(),
        };
        
        // Write config file
        let config_str = serde_json::to_string_pretty(&config)?;
        fs::write("chopin.config.json", config_str)?;
        
        // Update .gitignore
        let gitignore_path = PathBuf::from(".gitignore");
        let mut gitignore_content = String::new();
        if gitignore_path.exists() {
            gitignore_content = fs::read_to_string(&gitignore_path)?;
        }
        if !gitignore_content.contains(".chopin") {
            if !gitignore_content.ends_with('\n') {
                gitignore_content.push('\n');
            }
            gitignore_content.push_str(".chopin\n");
            fs::write(gitignore_path, gitignore_content)?;
        }
        
        Ok(config)
    }
} 
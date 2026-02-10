/**
 * Theme Manager & Settings UI Logic
 */

// Available Themes
const THEMES = ['emerald', 'blue', 'amber', 'violet', 'rose'];

// Initialize Theme
function initTheme() {
    const savedTheme = localStorage.getItem('lx_theme') || 'emerald';
    setTheme(savedTheme, false);
}

// Set Theme
function setTheme(themeName, save = true) {
    if (!THEMES.includes(themeName)) return;

    // Apply to Body
    document.documentElement.setAttribute('data-theme', themeName);

    // Save Preference
    if (save) {
        localStorage.setItem('lx_theme', themeName);
        console.log(`[Theme] Applied: ${themeName}`);
    }

    // Update UI (Checkmarks and Highlights)
    updateThemeSelectionUI(themeName);
}

function updateThemeSelectionUI(activeTheme) {
    document.querySelectorAll('.theme-option').forEach(btn => {
        const theme = btn.getAttribute('data-theme');
        if (theme === activeTheme) {
            btn.setAttribute('data-active', 'true');
        } else {
            btn.setAttribute('data-active', 'false');
        }
    });
}

function switchSettingsTab(tabName) {
    const panels = ['system', 'display', 'logic', 'logs'];

    // Deactivate all first
    panels.forEach(p => {
        const panel = document.getElementById(`settings-panel-${p}`);
        const tab = document.getElementById(`settings-tab-${p}`);

        if (panel) panel.classList.add('hidden');

        if (tab) {
            tab.classList.remove('text-emerald-600', 'border-emerald-600');
            tab.classList.add('text-gray-500', 'border-transparent', 'hover:text-emerald-600');
        }
    });

    // Activate the selected one
    const activePanel = document.getElementById(`settings-panel-${tabName}`);
    const activeTab = document.getElementById(`settings-tab-${tabName}`);

    if (activePanel) {
        activePanel.classList.remove('hidden');
    }

    if (activeTab) {
        activeTab.classList.add('text-emerald-600', 'border-emerald-600');
        activeTab.classList.remove('text-gray-500', 'border-transparent', 'hover:text-emerald-600');

        // Scroll to the active tab to make sure it's visible (for mobile)
        activeTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }

    // Special logic for logs
    if (tabName === 'logs' && window.renderSystemLogs) {
        window.renderSystemLogs();
    }
}

// Initialize on Load
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    // Default to System tab
    // switchSettingsTab('system'); // Not needed as it's default HTML state
});

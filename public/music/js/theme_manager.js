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

// Switch Settings Tabs
function switchSettingsTab(tabName) {
    // Panels
    const systemPanel = document.getElementById('settings-panel-system');
    const displayPanel = document.getElementById('settings-panel-display');

    // Tabs
    const systemTab = document.getElementById('settings-tab-system');
    const displayTab = document.getElementById('settings-tab-display');

    if (tabName === 'system') {
        systemPanel.classList.remove('hidden');
        displayPanel.classList.add('hidden');

        // Style Active System Tab
        systemTab.classList.add('text-emerald-600', 'border-emerald-600');
        systemTab.classList.remove('text-gray-500', 'border-transparent', 'hover:text-emerald-600');

        // Style Inactive Display Tab
        displayTab.classList.add('text-gray-500', 'border-transparent', 'hover:text-emerald-600');
        displayTab.classList.remove('text-emerald-600', 'border-emerald-600');

    } else if (tabName === 'display') {
        systemPanel.classList.add('hidden');
        displayPanel.classList.remove('hidden');

        // Style Active Display Tab
        displayTab.classList.add('text-emerald-600', 'border-emerald-600');
        displayTab.classList.remove('text-gray-500', 'border-transparent', 'hover:text-emerald-600');

        // Style Inactive System Tab
        systemTab.classList.add('text-gray-500', 'border-transparent', 'hover:text-emerald-600');
        systemTab.classList.remove('text-emerald-600', 'border-emerald-600');
    }
}

// Initialize on Load
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    // Default to System tab
    // switchSettingsTab('system'); // Not needed as it's default HTML state
});

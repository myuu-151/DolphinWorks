// DolphinWorks.exe: the app in a window of its own. Starts the app's server (server.py, beside it) with
// Python, hidden, and shows its interface in a WebView2 (the browser engine built into Windows); closing
// the window stops the server. Without WebView2, it falls back to server.py's own window (Edge, app mode).
// Built by build.bat; carries app.ico.
#define UNICODE
#define _UNICODE
#include <windows.h>
#include <dwmapi.h>
#include <shellapi.h>
#include <shlobj.h>
#include <wrl.h>
#include <string>
#include "WebView2.h"

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;

static ComPtr<ICoreWebView2Controller> controller;
static ComPtr<ICoreWebView2> webview;
static std::wstring url;
static HANDLE job;
static HWND main_window;

// --- the game, inside the window -----------------------------------------------------------------
// Run in Dolphin starts Dolphin in batch mode (its game window only); the page tells us its process and
// where its screen is, and we make Dolphin's game window a child of ours, placed there.

static struct
{
    DWORD pid = 0;                 // the game's Dolphin, 0 for none
    HANDLE process = NULL;
    HWND window = NULL;            // its game window, once found and taken in
    RECT place = {};               // where the page's screen is (client pixels)
    bool visible = false;
} game;

static void tell_page(const wchar_t *type, DWORD pid)
{
    if (webview)
    {
        wchar_t json[96];
        swprintf(json, 96, L"{\"type\":\"%s\",\"pid\":%lu}", type, pid);
        webview->PostWebMessageAsJson(json);
    }
}

// the biggest visible top-level window of the process: its game window (a dialog would be smaller)
static HWND find_game_window(DWORD pid)
{
    struct Search { DWORD pid; HWND best; LONG area; } search = { pid, NULL, 0 };
    EnumWindows([](HWND window, LPARAM param) -> BOOL {
        Search *s = (Search *)param;
        DWORD owner = 0;
        GetWindowThreadProcessId(window, &owner);
        RECT r;
        if (owner == s->pid && IsWindowVisible(window) && !GetWindow(window, GW_OWNER) && GetWindowRect(window, &r))
        {
            LONG area = (r.right - r.left) * (r.bottom - r.top);
            if ((r.right - r.left) > 200 && (r.bottom - r.top) > 150 && area > s->area)
                s->best = window, s->area = area;
        }
        return TRUE;
    }, (LPARAM)&search);
    return search.best;
}

static void place_game()
{
    if (!game.window)
        return;
    if (!game.visible)
    {
        ShowWindow(game.window, SW_HIDE);
        return;
    }
    SetWindowPos(game.window, HWND_TOP, game.place.left, game.place.top, game.place.right - game.place.left,
                 game.place.bottom - game.place.top, SWP_SHOWWINDOW | SWP_NOACTIVATE | SWP_FRAMECHANGED);
}

static void take_in(HWND window)
{
    LONG style = GetWindowLongW(window, GWL_STYLE);
    style &= ~(WS_POPUP | WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX);
    SetWindowLongW(window, GWL_STYLE, style | WS_CHILD | WS_CLIPSIBLINGS);
    LONG ex = GetWindowLongW(window, GWL_EXSTYLE);
    SetWindowLongW(window, GWL_EXSTYLE, ex & ~(WS_EX_APPWINDOW | WS_EX_WINDOWEDGE | WS_EX_DLGMODALFRAME | WS_EX_CLIENTEDGE));
    SetParent(window, main_window);
    game.window = window;
    place_game();
}

// back to a window of its own, on top of ours
static void let_go()
{
    if (!game.window)
        return;
    HWND window = game.window;
    SetParent(window, NULL);
    LONG style = GetWindowLongW(window, GWL_STYLE);
    SetWindowLongW(window, GWL_STYLE, (style & ~WS_CHILD) | WS_OVERLAPPEDWINDOW);
    RECT r;
    GetWindowRect(main_window, &r);
    SetWindowPos(window, HWND_TOP, r.left + 60, r.top + 60, 1280, 1000, SWP_SHOWWINDOW | SWP_FRAMECHANGED);
    SetForegroundWindow(window);
    game.window = NULL;
}

static void forget_game()
{
    if (game.process)
        CloseHandle(game.process);
    game = {};
    KillTimer(main_window, 1);
}

// asks Dolphin to stop (closing its game window ends a batch-mode Dolphin); ends it if it won't
static void stop_game(DWORD wait_ms)
{
    if (!game.pid)
        return;
    if (game.window)
        PostMessageW(game.window, WM_CLOSE, 0, 0);
    if (game.process && WaitForSingleObject(game.process, game.window ? wait_ms : 0) == WAIT_TIMEOUT)
        TerminateProcess(game.process, 0);
}

// every 100 ms while a game runs: take its window in once it appears; notice when Dolphin ends
static void watch_game()
{
    if (!game.pid)
        return;
    if (game.process && WaitForSingleObject(game.process, 0) == WAIT_OBJECT_0)
    {
        DWORD pid = game.pid;
        forget_game();
        tell_page(L"ended", pid);
        return;
    }
    if (game.window && !IsWindow(game.window))
        game.window = NULL;
    if (!game.window)
    {
        HWND window = find_game_window(game.pid);
        if (window)
        {
            take_in(window);
            tell_page(L"shown", game.pid);
        }
    }
}

// a number from the page's message, e.g. "pid":1234
static long field(const std::wstring &json, const wchar_t *name)
{
    size_t at = json.find(std::wstring(L"\"") + name + L"\":");
    return at == std::wstring::npos ? 0 : wcstol(json.c_str() + at + wcslen(name) + 3, NULL, 10);
}

static void on_page_message(const std::wstring &json)
{
    DWORD pid = (DWORD)field(json, L"pid");
    if (json.find(L"\"type\":\"embed\"") != std::wstring::npos && pid)
    {
        if (pid != game.pid)
        {
            stop_game(2000);                       // (another game was running)
            forget_game();
            game.pid = pid;
            game.process = OpenProcess(SYNCHRONIZE | PROCESS_TERMINATE, FALSE, pid);
            SetTimer(main_window, 1, 100, NULL);
        }
        LONG x = field(json, L"x"), y = field(json, L"y");
        game.place = { x, y, x + field(json, L"w"), y + field(json, L"h") };
        game.visible = field(json, L"visible") != 0;
        place_game();
    }
    else if (json.find(L"\"type\":\"stop\"") != std::wstring::npos)
        stop_game(3000);
    else if (json.find(L"\"type\":\"popout\"") != std::wstring::npos && pid == game.pid)
    {
        let_go();
        forget_game();
    }
}

// --- the server ----------------------------------------------------------------------------------

// Python's windowless launchers, tried in turn: "pyw -3" (the Python launcher), then pythonw on PATH.
static const wchar_t *pythons[] = { L"pyw.exe -3", L"pythonw.exe" };

// Starts server.py with --no-window and reads the address it serves on (its first line of output).
// The server is put in a job that ends it when this process ends, however that happens.
static bool start_server(const std::wstring &dir)
{
    job = CreateJobObjectW(NULL, NULL);
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = {};
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits));

    for (const wchar_t *python : pythons)
    {
        SECURITY_ATTRIBUTES inherit = { sizeof(inherit), NULL, TRUE };
        HANDLE read = NULL, write = NULL;
        if (!CreatePipe(&read, &write, &inherit, 0))
            return false;
        SetHandleInformation(read, HANDLE_FLAG_INHERIT, 0);

        std::wstring command = std::wstring(python) + L" \"" + dir + L"\\server.py\" --no-window";
        STARTUPINFOW startup = { sizeof(startup) };
        startup.dwFlags = STARTF_USESTDHANDLES;
        startup.hStdOutput = write;
        startup.hStdError = write;
        startup.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
        PROCESS_INFORMATION process;
        BOOL started = CreateProcessW(NULL, &command[0], NULL, NULL, TRUE, CREATE_NO_WINDOW | CREATE_SUSPENDED,
                                      NULL, dir.c_str(), &startup, &process);
        CloseHandle(write);
        if (!started)
        {
            CloseHandle(read);
            continue;
        }
        AssignProcessToJobObject(job, process.hProcess);
        ResumeThread(process.hThread);
        CloseHandle(process.hThread);

        // its first line: http://127.0.0.1:<port>/
        std::string line;
        char c;
        DWORD got;
        while (ReadFile(read, &c, 1, &got, NULL) && got && c != '\n')
            if (c != '\r')
                line += c;
        CloseHandle(read);
        CloseHandle(process.hProcess);
        if (line.rfind("http://", 0) == 0)
        {
            url.assign(line.begin(), line.end());
            return true;
        }
    }
    return false;
}

// --- the window ----------------------------------------------------------------------------------

static void fit(HWND window)
{
    if (controller)
    {
        RECT bounds;
        GetClientRect(window, &bounds);
        controller->put_Bounds(bounds);
    }
}

static LRESULT CALLBACK window_proc(HWND window, UINT message, WPARAM wparam, LPARAM lparam)
{
    switch (message)
    {
    case WM_SIZE:
        fit(window);
        return 0;
    case WM_GETMINMAXINFO:
        ((MINMAXINFO *)lparam)->ptMinTrackSize = { 960, 640 };
        return 0;
    case WM_TIMER:
        watch_game();
        return 0;
    case WM_CLOSE:
        stop_game(3000);                           // the game ends with the app, cleanly if it can
        forget_game();
        DestroyWindow(window);
        return 0;
    case WM_DESTROY:
        PostQuitMessage(0);
        return 0;
    }
    return DefWindowProcW(window, message, wparam, lparam);
}

static void show_page(HWND window, const std::wstring &data_dir)
{
    CreateCoreWebView2EnvironmentWithOptions(NULL, data_dir.c_str(), NULL,
        Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
            [window](HRESULT result, ICoreWebView2Environment *environment) -> HRESULT {
                if (FAILED(result))
                    return result;
                environment->CreateCoreWebView2Controller(window,
                    Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                        [window](HRESULT result, ICoreWebView2Controller *created) -> HRESULT {
                            if (FAILED(result) || !created)
                                return result;
                            controller = created;
                            controller->get_CoreWebView2(&webview);

                            // the app's own background while it loads (no white flash)
                            ComPtr<ICoreWebView2Controller2> controller2;
                            if (SUCCEEDED(controller.As(&controller2)))
                                controller2->put_DefaultBackgroundColor({ 255, 0x0b, 0x0e, 0x14 });

                            ComPtr<ICoreWebView2Settings> settings;
                            webview->get_Settings(&settings);
                            settings->put_IsStatusBarEnabled(FALSE);
                            settings->put_IsZoomControlEnabled(FALSE);
                            settings->put_AreDefaultContextMenusEnabled(FALSE);
                            settings->put_AreDevToolsEnabled(FALSE);

                            // links that would open a new window open in the default browser instead
                            webview->add_NewWindowRequested(
                                Callback<ICoreWebView2NewWindowRequestedEventHandler>(
                                    [](ICoreWebView2 *, ICoreWebView2NewWindowRequestedEventArgs *args) -> HRESULT {
                                        LPWSTR target = NULL;
                                        args->get_Uri(&target);
                                        if (target)
                                        {
                                            ShellExecuteW(NULL, L"open", target, NULL, NULL, SW_SHOWNORMAL);
                                            CoTaskMemFree(target);
                                        }
                                        args->put_Handled(TRUE);
                                        return S_OK;
                                    }).Get(), NULL);

                            // the page's messages: where the game's screen is, Stop, Pop out
                            webview->add_WebMessageReceived(
                                Callback<ICoreWebView2WebMessageReceivedEventHandler>(
                                    [](ICoreWebView2 *, ICoreWebView2WebMessageReceivedEventArgs *args) -> HRESULT {
                                        LPWSTR json = NULL;
                                        if (SUCCEEDED(args->get_WebMessageAsJson(&json)) && json)
                                        {
                                            on_page_message(json);
                                            CoTaskMemFree(json);
                                        }
                                        return S_OK;
                                    }).Get(), NULL);

                            fit(window);
                            webview->Navigate(url.c_str());
                            return S_OK;
                        }).Get());
                return S_OK;
            }).Get());
}

static bool has_webview2()
{
    LPWSTR version = NULL;
    if (FAILED(GetAvailableCoreWebView2BrowserVersionString(NULL, &version)) || !version)
        return false;
    CoTaskMemFree(version);
    return true;
}

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, LPWSTR, int show)
{
    wchar_t path[MAX_PATH];
    GetModuleFileNameW(NULL, path, MAX_PATH);
    std::wstring dir(path);
    dir.resize(dir.find_last_of(L'\\'));

    // its own taskbar button and group, not Edge's or Python's
    SetCurrentProcessExplicitAppUserModelID(L"DolphinWorks.App");
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);

    if (!has_webview2())
    {
        // no WebView2: the old way, server.py opening its own (Edge) window
        for (const wchar_t *python : pythons)
        {
            std::wstring command = std::wstring(python) + L" \"" + dir + L"\\server.py\"";
            STARTUPINFOW startup = { sizeof(startup) };
            PROCESS_INFORMATION process;
            if (CreateProcessW(NULL, &command[0], NULL, NULL, FALSE, 0, NULL, dir.c_str(), &startup, &process))
            {
                CloseHandle(process.hThread);
                CloseHandle(process.hProcess);
                return 0;
            }
        }
        MessageBoxW(NULL, L"DolphinWorks needs Python 3.\n\nRun dolphinworks.bat, in the folder above, to install everything.",
                    L"DolphinWorks", MB_ICONERROR | MB_OK);
        return 1;
    }
    if (!start_server(dir))
    {
        MessageBoxW(NULL, L"DolphinWorks needs Python 3 (and couldn't start its server).\n\n"
                          L"Run dolphinworks.bat, in the folder above, to install everything.",
                    L"DolphinWorks", MB_ICONERROR | MB_OK);
        return 1;
    }
    CoInitializeEx(NULL, COINIT_APARTMENTTHREADED);

    WNDCLASSEXW wc = { sizeof(wc) };
    wc.lpfnWndProc = window_proc;
    wc.hInstance = instance;
    wc.hIcon = (HICON)LoadImageW(instance, MAKEINTRESOURCEW(1), IMAGE_ICON, GetSystemMetrics(SM_CXICON),
                                 GetSystemMetrics(SM_CYICON), 0);
    wc.hIconSm = (HICON)LoadImageW(instance, MAKEINTRESOURCEW(1), IMAGE_ICON, GetSystemMetrics(SM_CXSMICON),
                                   GetSystemMetrics(SM_CYSMICON), 0);
    wc.hCursor = LoadCursorW(NULL, IDC_ARROW);
    wc.hbrBackground = CreateSolidBrush(RGB(0x0b, 0x0e, 0x14));
    wc.lpszClassName = L"DolphinWorks";
    RegisterClassExW(&wc);

    // 1440 x 960 (the design's size), or most of a smaller screen; centred
    RECT work;
    SystemParametersInfoW(SPI_GETWORKAREA, 0, &work, 0);
    UINT dpi = GetDpiForSystem();
    int w = min(MulDiv(1440, dpi, 96), (int)((work.right - work.left) * 0.94));
    int h = min(MulDiv(960, dpi, 96), (int)((work.bottom - work.top) * 0.94));
    HWND window = CreateWindowExW(0, L"DolphinWorks", L"DolphinWorks", WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN,
                                  work.left + (work.right - work.left - w) / 2, work.top + (work.bottom - work.top - h) / 2,
                                  w, h, NULL, NULL, instance, NULL);
    main_window = window;
    BOOL dark = TRUE;                                  // a dark title bar, like the app
    DwmSetWindowAttribute(window, 20 /* DWMWA_USE_IMMERSIVE_DARK_MODE */, &dark, sizeof(dark));
    COLORREF caption = RGB(0x0d, 0x11, 0x18);
    DwmSetWindowAttribute(window, 35 /* DWMWA_CAPTION_COLOR */, &caption, sizeof(caption));
    ShowWindow(window, show);
    UpdateWindow(window);

    // the browser's own files (cache, settings) in %LOCALAPPDATA%\DolphinWorks
    wchar_t *local = NULL;
    std::wstring data_dir = dir + L"\\.window";
    if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, NULL, &local)))
    {
        data_dir = std::wstring(local) + L"\\DolphinWorks";
        CoTaskMemFree(local);
    }
    show_page(window, data_dir);

    MSG message;
    while (GetMessageW(&message, NULL, 0, 0))
    {
        TranslateMessage(&message);
        DispatchMessageW(&message);
    }
    controller = nullptr;
    webview = nullptr;
    CloseHandle(job);                                  // ends the server
    CoUninitialize();
    return 0;
}

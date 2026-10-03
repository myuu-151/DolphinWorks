// DolphinWorks.exe: starts the app (server.py, beside it) with Python, without a console window.
// Built by build.bat; carries app.ico.
#include <windows.h>
#include <stdio.h>
#include <wchar.h>

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE previous, LPWSTR args, int show)
{
    wchar_t dir[MAX_PATH];
    GetModuleFileNameW(NULL, dir, MAX_PATH);
    wchar_t *slash = wcsrchr(dir, L'\\');
    if (slash) *slash = 0;

    // Python's windowless launchers: "pyw -3" (the Python launcher), then pythonw on PATH
    const wchar_t *pythons[] = { L"pyw.exe -3", L"pythonw.exe" };
    for (int i = 0; i < 2; i++)
    {
        wchar_t command[MAX_PATH * 2];
        swprintf(command, MAX_PATH * 2, L"%s \"%s\\server.py\"", pythons[i], dir);
        STARTUPINFOW startup = { sizeof(startup) };
        PROCESS_INFORMATION process;
        if (CreateProcessW(NULL, command, NULL, NULL, FALSE, 0, NULL, dir, &startup, &process))
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

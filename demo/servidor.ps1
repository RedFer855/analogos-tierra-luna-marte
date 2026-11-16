param([int]$Puerto = 8123, [switch]$NoAbrir)
$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $MyInvocation.MyCommand.Definition

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.htm'  = 'text/html; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.mjs'  = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.wasm' = 'application/wasm'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.gif'  = 'image/gif'
  '.glb'  = 'model/gltf-binary'
  '.gltf' = 'model/gltf+json'
  '.bin'  = 'application/octet-stream'
  '.txt'  = 'text/plain; charset=utf-8'
  '.md'   = 'text/plain; charset=utf-8'
  '.terrain' = 'application/vnd.quantized-mesh'
  '.xml'  = 'application/xml; charset=utf-8'
  '.woff' = 'font/woff'
  '.woff2' = 'font/woff2'
  '.ttf'  = 'font/ttf'
}

function Responder($flujo, [int]$codigo, [string]$tipo, [byte[]]$cuerpo) {
  $motivo = 'OK'
  if ($codigo -eq 404) { $motivo = 'Not Found' }
  if ($codigo -eq 400) { $motivo = 'Bad Request' }
  $cab = "HTTP/1.1 $codigo $motivo`r`nContent-Type: $tipo`r`nContent-Length: $($cuerpo.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n"
  $b = [System.Text.Encoding]::ASCII.GetBytes($cab)
  $flujo.Write($b, 0, $b.Length)
  if ($cuerpo.Length -gt 0) { $flujo.Write($cuerpo, 0, $cuerpo.Length) }
  $flujo.Flush()
}

# El puerto 8123 puede estar ocupado: se prueban los siguientes diez.
$oyente = $null
for ($p = $Puerto; $p -lt ($Puerto + 10); $p++) {
  try {
    $prueba = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $p)
    $prueba.Start()
    $oyente = $prueba
    $Puerto = $p
    break
  } catch {
    if ($p -eq ($Puerto + 9)) { throw "No hay puerto libre entre $Puerto y $($Puerto + 9)." }
  }
}

$url = "http://127.0.0.1:$Puerto/"
Write-Host ""
Write-Host "  Análogos Tierra · Luna · Marte  —  NASA Space Apps 2026 (J4Ks)"
Write-Host "  Visor listo en $url"
Write-Host "  No cierres esta ventana. Para salir: cerrar la ventana o Ctrl+C."
Write-Host ""
if (-not $NoAbrir) { Start-Process $url }

while ($true) {
  $cli = $oyente.AcceptTcpClient()
  try {
    $flujo = $cli.GetStream()
    $flujo.ReadTimeout = 5000
    $lector = New-Object System.IO.StreamReader($flujo, [System.Text.Encoding]::ASCII)
    $peticion = $lector.ReadLine()
    if ([string]::IsNullOrWhiteSpace($peticion)) { $cli.Close(); continue }
    while ($true) {
      $linea = $lector.ReadLine()
      if ([string]::IsNullOrEmpty($linea)) { break }
    }
    $partes = $peticion.Split(' ')
    $crudo = '/'
    if ($partes.Length -ge 2) { $crudo = $partes[1] }
    $crudo = $crudo.Split('?')[0]
    $crudo = [System.Uri]::UnescapeDataString($crudo)
    if ($crudo -eq '/') { $crudo = '/index.html' }
    $rel = $crudo.TrimStart('/').Replace('/', [System.IO.Path]::DirectorySeparatorChar)
    $pleno = [System.IO.Path]::GetFullPath((Join-Path $raiz $rel))

    if (-not $pleno.StartsWith($raiz, [System.StringComparison]::OrdinalIgnoreCase)) {
      Responder $flujo 400 'text/plain; charset=utf-8' ([System.Text.Encoding]::UTF8.GetBytes('ruta invalida'))
    }
    elseif (Test-Path -LiteralPath $pleno -PathType Leaf) {
      $ext = [System.IO.Path]::GetExtension($pleno).ToLowerInvariant()
      $tipo = $mime[$ext]
      if (-not $tipo) { $tipo = 'application/octet-stream' }
      $cuerpo = [System.IO.File]::ReadAllBytes($pleno)
      Responder $flujo 200 $tipo $cuerpo
    }
    else {
      Responder $flujo 404 'text/plain; charset=utf-8' ([System.Text.Encoding]::UTF8.GetBytes("no existe: $crudo"))
    }
    $flujo.Close()
  }
  catch {
    Write-Host "aviso: $($_.Exception.Message)"
  }
  finally {
    $cli.Close()
  }
}

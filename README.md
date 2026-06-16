# Guardianes de la Vía

Aplicación web construida con Flask. Lista para desplegar en local o en un VPS con Gunicorn.

## Ejecutar localmente

```bash
pip install -r requirements.txt
python run.py
```
```bash
Con un ambiente 
python run_env.py
```

## Desplegar en VPS con Gunicorn

```bash
gunicorn -w 4 -b 0.0.0.0:8000 wsgi:app
```


## Desplegar la bd
```bash
Descargar XAMPP
Crear la base de datos con este nombre u230659573_guardia
En phpmyadmin seleccionas la base de datos y te vas a sql, 
copeas el codigo que hay en el archivo 
u230659573_guardia.sql 
y le quitas todos los COLLATE=utf8mb4_general_ci 
```
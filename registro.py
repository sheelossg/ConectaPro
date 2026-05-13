import tkinter as tk
from tkinter import messagebox
import pandas as pd

class RegistroApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Registro - ConectaPro")
        self.root.geometry("400x300")

        # Campo para RUT
        tk.Label(root, text="Ingrese su RUT:").pack(pady=10)
        self.rut_entry = tk.Entry(root)
        self.rut_entry.pack(pady=5)

        # Botón para buscar
        tk.Button(root, text="Buscar y Registrar", command=self.buscar_rut).pack(pady=20)

        # Cargar datos del Excel
        try:
            self.df = pd.read_csv('datos.csv')
        except FileNotFoundError:
            messagebox.showerror("Error", "Archivo 'datos.csv' no encontrado.")
            self.df = pd.DataFrame()

    def buscar_rut(self):
        rut = self.rut_entry.get().strip()
        if not rut:
            messagebox.showwarning("Advertencia", "Por favor ingrese un RUT.")
            return

        # Buscar en el DataFrame
        resultado = self.df[self.df['RUT'].astype(str).str.strip() == rut]

        if not resultado.empty:
            # Autocompletar datos
            nombre = resultado['Nombre'].values[0]
            titulo = resultado['TITULO'].values[0]
            edad = resultado['EDAD'].values[0]
            antecedentes = resultado['ANTECEDENTES'].values[0]

            # Determinar tipo (asumiendo columna 'Tipo' con 'empresa' o 'trabajador')
            tipo = resultado.get('Tipo', pd.Series(['trabajador'])).values[0] if 'Tipo' in resultado.columns else 'trabajador'

            # Mostrar ventana de perfil
            self.mostrar_perfil(rut, nombre, titulo, edad, antecedentes, tipo)
        else:
            messagebox.showinfo("No encontrado", "No registra info para este RUT.")

    def mostrar_perfil(self, rut, nombre, titulo, edad, antecedentes, tipo):
        # Nueva ventana de perfil
        perfil_window = tk.Toplevel(self.root)
        perfil_window.title("Perfil - ConectaPro")
        perfil_window.geometry("500x400")

        tk.Label(perfil_window, text=f"Perfil de {tipo.capitalize()}", font=("Arial", 16)).pack(pady=10)

        # Mostrar datos
        tk.Label(perfil_window, text=f"Nombre: {nombre}").pack(anchor="w", padx=20)
        tk.Label(perfil_window, text=f"RUT: {rut}").pack(anchor="w", padx=20)
        tk.Label(perfil_window, text=f"Título: {titulo}").pack(anchor="w", padx=20)
        tk.Label(perfil_window, text=f"Edad: {edad}").pack(anchor="w", padx=20)
        tk.Label(perfil_window, text=f"Antecedentes: {antecedentes}").pack(anchor="w", padx=20)

        # Botón para cerrar
        tk.Button(perfil_window, text="Cerrar", command=perfil_window.destroy).pack(pady=20)

        # Reemplazar vista según tipo (simulado con mensaje)
        if tipo == 'empresa':
            messagebox.showinfo("Vista Reemplazada", "Esta ventana reemplaza la vista de Empleos para empresas.")
        elif tipo == 'trabajador':
            messagebox.showinfo("Vista Reemplazada", "Esta ventana reemplaza la vista de Talentos para trabajadores.")

if __name__ == "__main__":
    root = tk.Tk()
    app = RegistroApp(root)
    root.mainloop()